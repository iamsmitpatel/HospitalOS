import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PermissionsGuard } from './permissions.guard';
import {
  Permission,
  ROLE_PERMISSIONS,
  roleHasPermission,
} from '../constants/permissions.constants';

function makeContext(user: { role: Role } | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('permissions foundation', () => {
  describe('ROLE_PERMISSIONS map', () => {
    it('grants SUPER_ADMIN platform-administration permissions', () => {
      expect(roleHasPermission(Role.SUPER_ADMIN, Permission.HOSPITAL_CREATE)).toBe(true);
      expect(roleHasPermission(Role.SUPER_ADMIN, Permission.USER_CREATE)).toBe(true);
    });

    it('does not grant HOSPITAL_ADMIN platform-wide hospital management', () => {
      expect(roleHasPermission(Role.HOSPITAL_ADMIN, Permission.HOSPITAL_CREATE)).toBe(false);
      expect(roleHasPermission(Role.HOSPITAL_ADMIN, Permission.HOSPITAL_LIST)).toBe(false);
    });

    it('grants HOSPITAL_ADMIN tenant-scoped user management', () => {
      expect(roleHasPermission(Role.HOSPITAL_ADMIN, Permission.USER_CREATE)).toBe(true);
      expect(roleHasPermission(Role.HOSPITAL_ADMIN, Permission.USER_READ)).toBe(true);
    });

    it('grants clinical/staff roles no platform (hospital/user) permissions (§14 — never modeled, never implied)', () => {
      for (const role of [
        Role.DOCTOR,
        Role.NURSE,
        Role.RECEPTIONIST,
        Role.PHARMACIST,
        Role.LAB_TECHNICIAN,
        Role.ACCOUNTANT,
        Role.PATIENT,
      ]) {
        expect(roleHasPermission(role, Permission.HOSPITAL_CREATE)).toBe(false);
        expect(roleHasPermission(role, Permission.USER_CREATE)).toBe(false);
      }
    });

    it('grants Role.PATIENT zero permissions (Phase 3 builds no patient self-service endpoints)', () => {
      expect(ROLE_PERMISSIONS[Role.PATIENT]).toEqual([]);
    });

    it('grants DOCTOR/NURSE/RECEPTIONIST the full clinical operational workflow (patient, appointment, queue)', () => {
      for (const role of [Role.DOCTOR, Role.NURSE, Role.RECEPTIONIST]) {
        expect(roleHasPermission(role, Permission.PATIENT_CREATE)).toBe(true);
        expect(roleHasPermission(role, Permission.APPOINTMENT_CREATE)).toBe(true);
        expect(roleHasPermission(role, Permission.QUEUE_OPERATE)).toBe(true);
      }
    });

    it('grants only DOCTOR permission to manage schedules (ownership itself is checked at the service layer)', () => {
      expect(roleHasPermission(Role.DOCTOR, Permission.DOCTOR_SCHEDULE_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.NURSE, Permission.DOCTOR_SCHEDULE_MANAGE)).toBe(false);
      expect(roleHasPermission(Role.RECEPTIONIST, Permission.DOCTOR_SCHEDULE_MANAGE)).toBe(false);
    });

    it('grants PHARMACIST/LAB_TECHNICIAN/ACCOUNTANT read-only access, no write/operational permissions', () => {
      for (const role of [Role.PHARMACIST, Role.LAB_TECHNICIAN, Role.ACCOUNTANT]) {
        expect(roleHasPermission(role, Permission.PATIENT_READ)).toBe(true);
        expect(roleHasPermission(role, Permission.PATIENT_CREATE)).toBe(false);
        expect(roleHasPermission(role, Permission.APPOINTMENT_CREATE)).toBe(false);
        expect(roleHasPermission(role, Permission.QUEUE_OPERATE)).toBe(false);
      }
    });

    it('does not grant SUPER_ADMIN any patient/appointment/queue permission (clinical data stays excluded)', () => {
      for (const permission of [
        Permission.PATIENT_READ,
        Permission.PATIENT_CREATE,
        Permission.APPOINTMENT_READ,
        Permission.APPOINTMENT_CREATE,
        Permission.QUEUE_READ,
        Permission.QUEUE_OPERATE,
      ]) {
        expect(roleHasPermission(Role.SUPER_ADMIN, permission)).toBe(false);
      }
    });

    it('grants SUPER_ADMIN department/doctor org-structure permissions (platform-administration-adjacent, not clinical)', () => {
      expect(roleHasPermission(Role.SUPER_ADMIN, Permission.DEPARTMENT_CREATE)).toBe(true);
      expect(roleHasPermission(Role.SUPER_ADMIN, Permission.DOCTOR_CREATE)).toBe(true);
    });

    it('every Role enum value has an explicit entry (no silent fallthrough)', () => {
      for (const role of Object.values(Role)) {
        expect(ROLE_PERMISSIONS[role]).toBeDefined();
      }
    });
  });

  describe('PermissionsGuard', () => {
    const reflector = new Reflector();
    const guard = new PermissionsGuard(reflector);

    it('allows the request when the route has no @RequirePermissions metadata', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      expect(guard.canActivate(makeContext({ role: Role.PATIENT }))).toBe(true);
    });

    it('denies an unauthenticated request when permissions are required', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.USER_READ]);
      expect(guard.canActivate(makeContext(undefined))).toBe(false);
    });

    it('denies a role missing the required permission', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.HOSPITAL_CREATE]);
      expect(guard.canActivate(makeContext({ role: Role.HOSPITAL_ADMIN }))).toBe(false);
    });

    it('allows a role holding the required permission', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.USER_CREATE]);
      expect(guard.canActivate(makeContext({ role: Role.HOSPITAL_ADMIN }))).toBe(true);
    });

    it('requires every listed permission, not just one', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue([Permission.USER_CREATE, Permission.HOSPITAL_CREATE]);
      expect(guard.canActivate(makeContext({ role: Role.HOSPITAL_ADMIN }))).toBe(false);
      expect(guard.canActivate(makeContext({ role: Role.SUPER_ADMIN }))).toBe(true);
    });
  });
});
