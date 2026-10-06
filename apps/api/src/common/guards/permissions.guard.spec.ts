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

    it('grants Role.PATIENT exactly the Connect portal permission, nothing from the staff model (Phase 3: zero; Phase 5: patient_portal.access only)', () => {
      expect(ROLE_PERMISSIONS[Role.PATIENT]).toEqual([Permission.PATIENT_PORTAL_ACCESS]);
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

    it('grants PHARMACIST/LAB_TECHNICIAN/ACCOUNTANT patient read access but no front-desk registration/appointment/queue permissions (their operational writes are scoped to their own domain instead — see Phase 4 assertions below)', () => {
      for (const role of [Role.PHARMACIST, Role.LAB_TECHNICIAN, Role.ACCOUNTANT]) {
        expect(roleHasPermission(role, Permission.PATIENT_READ)).toBe(true);
        expect(roleHasPermission(role, Permission.PATIENT_CREATE)).toBe(false);
        expect(roleHasPermission(role, Permission.APPOINTMENT_CREATE)).toBe(false);
        expect(roleHasPermission(role, Permission.QUEUE_OPERATE)).toBe(false);
      }
    });

    it('Phase 4: grants only DOCTOR clinical documentation authorship (encounter, notes, diagnosis, prescription) — not NURSE or RECEPTIONIST', () => {
      expect(roleHasPermission(Role.DOCTOR, Permission.ENCOUNTER_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.DOCTOR, Permission.CLINICAL_NOTE_CREATE)).toBe(true);
      expect(roleHasPermission(Role.DOCTOR, Permission.DIAGNOSIS_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.DOCTOR, Permission.PRESCRIPTION_MANAGE)).toBe(true);

      for (const role of [Role.NURSE, Role.RECEPTIONIST]) {
        expect(roleHasPermission(role, Permission.ENCOUNTER_MANAGE)).toBe(false);
        expect(roleHasPermission(role, Permission.CLINICAL_NOTE_CREATE)).toBe(false);
        expect(roleHasPermission(role, Permission.DIAGNOSIS_MANAGE)).toBe(false);
        expect(roleHasPermission(role, Permission.PRESCRIPTION_MANAGE)).toBe(false);
      }
    });

    it('Phase 4: grants NURSE vitals but nothing beyond (master doc §52 — "Nurse: vital signs where permitted")', () => {
      expect(roleHasPermission(Role.NURSE, Permission.VITALS_CREATE)).toBe(true);
      expect(roleHasPermission(Role.NURSE, Permission.CLINICAL_NOTE_CREATE)).toBe(false);
      expect(roleHasPermission(Role.RECEPTIONIST, Permission.VITALS_CREATE)).toBe(false);
    });

    it('Phase 4: grants RECEPTIONIST front-desk billing (invoice/payment) but never refunds', () => {
      expect(roleHasPermission(Role.RECEPTIONIST, Permission.INVOICE_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.RECEPTIONIST, Permission.PAYMENT_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.RECEPTIONIST, Permission.PAYMENT_REFUND)).toBe(false);
    });

    it('Phase 4: DOCTOR never gets financial administration (master doc §51)', () => {
      expect(roleHasPermission(Role.DOCTOR, Permission.INVOICE_MANAGE)).toBe(false);
      expect(roleHasPermission(Role.DOCTOR, Permission.PAYMENT_MANAGE)).toBe(false);
      expect(roleHasPermission(Role.DOCTOR, Permission.PAYMENT_REFUND)).toBe(false);
    });

    it('Phase 4: grants PHARMACIST dispensing and inventory, nothing clinical or financial', () => {
      expect(roleHasPermission(Role.PHARMACIST, Permission.PHARMACY_DISPENSE)).toBe(true);
      expect(roleHasPermission(Role.PHARMACIST, Permission.INVENTORY_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.PHARMACIST, Permission.DIAGNOSIS_MANAGE)).toBe(false);
      expect(roleHasPermission(Role.PHARMACIST, Permission.INVOICE_MANAGE)).toBe(false);
    });

    it('Phase 4: grants LAB_TECHNICIAN the lab workflow, nothing clinical-authorship or financial ("Accountant should not modify clinical notes" implies the inverse too, §55)', () => {
      expect(roleHasPermission(Role.LAB_TECHNICIAN, Permission.LAB_RESULT_ENTER)).toBe(true);
      expect(roleHasPermission(Role.LAB_TECHNICIAN, Permission.LAB_RESULT_VERIFY)).toBe(true);
      expect(roleHasPermission(Role.LAB_TECHNICIAN, Permission.DIAGNOSIS_MANAGE)).toBe(false);
      expect(roleHasPermission(Role.LAB_TECHNICIAN, Permission.INVOICE_MANAGE)).toBe(false);
    });

    it('Phase 4: ACCOUNTANT never touches clinical records (master doc §55)', () => {
      expect(roleHasPermission(Role.ACCOUNTANT, Permission.PAYMENT_REFUND)).toBe(true);
      expect(roleHasPermission(Role.ACCOUNTANT, Permission.DIAGNOSIS_MANAGE)).toBe(false);
      expect(roleHasPermission(Role.ACCOUNTANT, Permission.CLINICAL_NOTE_CREATE)).toBe(false);
      expect(roleHasPermission(Role.ACCOUNTANT, Permission.PHARMACY_DISPENSE)).toBe(false);
    });

    it('Phase 4: HOSPITAL_ADMIN gets catalog/financial administration but no clinical-record access at all — same principle as SUPER_ADMIN, applied one level down', () => {
      expect(roleHasPermission(Role.HOSPITAL_ADMIN, Permission.MEDICINE_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.HOSPITAL_ADMIN, Permission.INVOICE_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.HOSPITAL_ADMIN, Permission.PAYMENT_REFUND)).toBe(true);
      for (const permission of [
        Permission.ENCOUNTER_READ,
        Permission.ENCOUNTER_MANAGE,
        Permission.VITALS_CREATE,
        Permission.CLINICAL_NOTE_CREATE,
        Permission.DIAGNOSIS_MANAGE,
        Permission.PRESCRIPTION_MANAGE,
        Permission.PRESCRIPTION_READ,
        Permission.LAB_ORDER_CREATE,
        Permission.LAB_RESULT_ENTER,
        Permission.LAB_RESULT_READ,
      ]) {
        expect(roleHasPermission(Role.HOSPITAL_ADMIN, permission)).toBe(false);
      }
    });

    it('Phase 4: SUPER_ADMIN gets catalog permissions (medicine/labtest/service) but nothing patient-touching', () => {
      expect(roleHasPermission(Role.SUPER_ADMIN, Permission.MEDICINE_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.SUPER_ADMIN, Permission.LABTEST_MANAGE)).toBe(true);
      expect(roleHasPermission(Role.SUPER_ADMIN, Permission.SERVICE_MANAGE)).toBe(true);
      for (const permission of [
        Permission.ENCOUNTER_MANAGE,
        Permission.DIAGNOSIS_MANAGE,
        Permission.PRESCRIPTION_MANAGE,
        Permission.LAB_RESULT_ENTER,
        Permission.PHARMACY_DISPENSE,
        Permission.INVOICE_MANAGE,
        Permission.PAYMENT_MANAGE,
        Permission.PAYMENT_REFUND,
      ]) {
        expect(roleHasPermission(Role.SUPER_ADMIN, permission)).toBe(false);
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

  describe('Phase 5: HospitalOS Connect', () => {
    it('grants only PATIENT the patient-portal permission', () => {
      expect(roleHasPermission(Role.PATIENT, Permission.PATIENT_PORTAL_ACCESS)).toBe(true);
      for (const role of [
        Role.SUPER_ADMIN,
        Role.HOSPITAL_ADMIN,
        Role.DOCTOR,
        Role.NURSE,
        Role.RECEPTIONIST,
        Role.PHARMACIST,
        Role.LAB_TECHNICIAN,
        Role.ACCOUNTANT,
      ]) {
        expect(roleHasPermission(role, Permission.PATIENT_PORTAL_ACCESS)).toBe(false);
      }
    });

    it('PATIENT holds no staff permission of any kind', () => {
      expect(roleHasPermission(Role.PATIENT, Permission.PATIENT_READ)).toBe(false);
      expect(roleHasPermission(Role.PATIENT, Permission.APPOINTMENT_READ)).toBe(false);
      expect(roleHasPermission(Role.PATIENT, Permission.ENCOUNTER_READ)).toBe(false);
      expect(roleHasPermission(Role.PATIENT, Permission.INVOICE_READ)).toBe(false);
    });

    it('grants HOSPITAL_PUBLIC_PROFILE_MANAGE to HOSPITAL_ADMIN and SUPER_ADMIN only', () => {
      expect(
        roleHasPermission(Role.HOSPITAL_ADMIN, Permission.HOSPITAL_PUBLIC_PROFILE_MANAGE),
      ).toBe(true);
      expect(roleHasPermission(Role.SUPER_ADMIN, Permission.HOSPITAL_PUBLIC_PROFILE_MANAGE)).toBe(
        true,
      );
      expect(roleHasPermission(Role.DOCTOR, Permission.HOSPITAL_PUBLIC_PROFILE_MANAGE)).toBe(false);
      expect(roleHasPermission(Role.PATIENT, Permission.HOSPITAL_PUBLIC_PROFILE_MANAGE)).toBe(
        false,
      );
    });
  });
});
