import { Role } from '@prisma/client';

/**
 * Permission foundation (master doc §13/§14). Deliberately small — this is
 * the scaffold for "Role -> Permissions" authorization, not an attempt to
 * model every future permission. Add new permissions here and extend
 * ROLE_PERMISSIONS; do not scatter new role checks across controllers.
 *
 * SUPER_ADMIN is platform administration, not clinical access (§14) — note
 * that it is NOT granted every permission automatically. Its entry below is
 * explicit, and deliberately excludes every patient/appointment/queue
 * permission (Phase 3): those touch patient-identifiable operational data,
 * not platform administration. SUPER_ADMIN DOES get department/doctor
 * permissions — hospital org structure (departments, doctor roster) is
 * judged platform-administration-adjacent the same way Users/Hospitals are,
 * not clinical data. See /SECURITY.md and /DECISIONS.md for the line drawn
 * between the two groups.
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

  DEPARTMENT_READ: 'department.read',
  DEPARTMENT_CREATE: 'department.create',
  DEPARTMENT_UPDATE: 'department.update',

  DOCTOR_READ: 'doctor.read',
  DOCTOR_CREATE: 'doctor.create',
  DOCTOR_UPDATE: 'doctor.update',
  DOCTOR_SCHEDULE_MANAGE: 'doctor.schedule.manage',

  PATIENT_READ: 'patient.read',
  PATIENT_CREATE: 'patient.create',
  PATIENT_UPDATE: 'patient.update',

  APPOINTMENT_READ: 'appointment.read',
  APPOINTMENT_CREATE: 'appointment.create',
  APPOINTMENT_UPDATE: 'appointment.update',
  APPOINTMENT_CANCEL: 'appointment.cancel',
  APPOINTMENT_RESCHEDULE: 'appointment.reschedule',

  QUEUE_READ: 'queue.read',
  /** Covers call-next/skip/start-consultation/complete/cancel — one permission, not five (§13: don't model hundreds prematurely). */
  QUEUE_OPERATE: 'queue.operate',
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
  Permission.DEPARTMENT_READ,
  Permission.DEPARTMENT_CREATE,
  Permission.DEPARTMENT_UPDATE,
  Permission.DOCTOR_READ,
  Permission.DOCTOR_CREATE,
  Permission.DOCTOR_UPDATE,
  Permission.DOCTOR_SCHEDULE_MANAGE,
];

const HOSPITAL_ADMIN_PERMISSIONS: PermissionType[] = [
  Permission.HOSPITAL_READ,
  Permission.USER_READ,
  Permission.USER_CREATE,
  Permission.USER_UPDATE,
  Permission.USER_DEACTIVATE,
  Permission.DEPARTMENT_READ,
  Permission.DEPARTMENT_CREATE,
  Permission.DEPARTMENT_UPDATE,
  Permission.DOCTOR_READ,
  Permission.DOCTOR_CREATE,
  Permission.DOCTOR_UPDATE,
  Permission.DOCTOR_SCHEDULE_MANAGE,
  Permission.PATIENT_READ,
  Permission.PATIENT_CREATE,
  Permission.PATIENT_UPDATE,
  Permission.APPOINTMENT_READ,
  Permission.APPOINTMENT_CREATE,
  Permission.APPOINTMENT_UPDATE,
  Permission.APPOINTMENT_CANCEL,
  Permission.APPOINTMENT_RESCHEDULE,
  Permission.QUEUE_READ,
  Permission.QUEUE_OPERATE,
];

/** Front-desk/clinical operational staff: full patient/appointment/queue workflow, own-schedule management for DOCTOR only. */
const CLINICAL_OPERATIONAL_PERMISSIONS: PermissionType[] = [
  Permission.DEPARTMENT_READ,
  Permission.DOCTOR_READ,
  Permission.PATIENT_READ,
  Permission.PATIENT_CREATE,
  Permission.PATIENT_UPDATE,
  Permission.APPOINTMENT_READ,
  Permission.APPOINTMENT_CREATE,
  Permission.APPOINTMENT_UPDATE,
  Permission.APPOINTMENT_CANCEL,
  Permission.APPOINTMENT_RESCHEDULE,
  Permission.QUEUE_READ,
  Permission.QUEUE_OPERATE,
];

const DOCTOR_PERMISSIONS: PermissionType[] = [
  ...CLINICAL_OPERATIONAL_PERMISSIONS,
  // A DOCTOR may manage only their own schedule — enforced at the service
  // layer (ownership check), not by a separate permission, same pattern as
  // other "own resource" rules in this codebase.
  Permission.DOCTOR_SCHEDULE_MANAGE,
];

/** Read-only support roles: can see org structure and patient records, no write/operational access to the scheduling workflow. */
const READ_ONLY_SUPPORT_PERMISSIONS: PermissionType[] = [
  Permission.DEPARTMENT_READ,
  Permission.DOCTOR_READ,
  Permission.PATIENT_READ,
];

/**
 * Every role's permission set is listed explicitly — none are inherited
 * implicitly from another role. Role.PATIENT (a login role, reserved for
 * Phase 5 patient self-service / HospitalOS Connect — not to be confused
 * with the Patient clinical entity) gets zero permissions here; this phase
 * builds no patient-facing operational endpoints (§3, §55 deferred).
 */
export const ROLE_PERMISSIONS: Record<Role, PermissionType[]> = {
  [Role.SUPER_ADMIN]: PLATFORM_ADMIN_PERMISSIONS,
  [Role.HOSPITAL_ADMIN]: HOSPITAL_ADMIN_PERMISSIONS,
  [Role.DOCTOR]: DOCTOR_PERMISSIONS,
  [Role.NURSE]: CLINICAL_OPERATIONAL_PERMISSIONS,
  [Role.RECEPTIONIST]: CLINICAL_OPERATIONAL_PERMISSIONS,
  [Role.PHARMACIST]: READ_ONLY_SUPPORT_PERMISSIONS,
  [Role.LAB_TECHNICIAN]: READ_ONLY_SUPPORT_PERMISSIONS,
  [Role.ACCOUNTANT]: READ_ONLY_SUPPORT_PERMISSIONS,
  [Role.PATIENT]: [],
};

export function roleHasPermission(role: Role, permission: PermissionType): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
