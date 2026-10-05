import { Role } from '@prisma/client';

/**
 * Permission foundation (master doc §13/§14). Deliberately small — this is
 * the scaffold for "Role -> Permissions" authorization, not an attempt to
 * model every future permission. Add new permissions here and extend
 * ROLE_PERMISSIONS; do not scatter new role checks across controllers.
 *
 * SUPER_ADMIN is platform administration, not clinical access (§14) — note
 * that it is NOT granted every permission automatically. Its entry below is
 * explicit, and intentionally does not include any future patient/clinical
 * permission. A platform administrator gets exactly what's listed, nothing
 * implied by the role name alone.
 */
export const Permission = {
  HOSPITAL_READ: 'hospital.read',
  HOSPITAL_CREATE: 'hospital.create',
  HOSPITAL_UPDATE: 'hospital.update',
  HOSPITAL_LIST: 'hospital.list',
  USER_READ: 'user.read',
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DEACTIVATE: 'user.deactivate',
  ROLE_ASSIGN: 'role.assign',
} as const;

export type PermissionType = (typeof Permission)[keyof typeof Permission];

const PLATFORM_ADMIN_PERMISSIONS: PermissionType[] = [
  Permission.HOSPITAL_READ,
  Permission.HOSPITAL_CREATE,
  Permission.HOSPITAL_UPDATE,
  Permission.HOSPITAL_LIST,
  Permission.USER_READ,
  Permission.USER_CREATE,
  Permission.USER_UPDATE,
  Permission.USER_DEACTIVATE,
  Permission.ROLE_ASSIGN,
];

const HOSPITAL_ADMIN_PERMISSIONS: PermissionType[] = [
  Permission.HOSPITAL_READ,
  Permission.USER_READ,
  Permission.USER_CREATE,
  Permission.USER_UPDATE,
  Permission.USER_DEACTIVATE,
];

/**
 * Every role's permission set is listed explicitly — none are inherited
 * implicitly from another role. Clinical/staff roles have no platform
 * permissions today; that is expected, not an oversight (see module docstring).
 */
export const ROLE_PERMISSIONS: Record<Role, PermissionType[]> = {
  [Role.SUPER_ADMIN]: PLATFORM_ADMIN_PERMISSIONS,
  [Role.HOSPITAL_ADMIN]: HOSPITAL_ADMIN_PERMISSIONS,
  [Role.DOCTOR]: [],
  [Role.NURSE]: [],
  [Role.RECEPTIONIST]: [],
  [Role.PHARMACIST]: [],
  [Role.LAB_TECHNICIAN]: [],
  [Role.ACCOUNTANT]: [],
  [Role.PATIENT]: [],
};

export function roleHasPermission(role: Role, permission: PermissionType): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
