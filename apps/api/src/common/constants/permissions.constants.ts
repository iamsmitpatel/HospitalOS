import { Role } from '@prisma/client';

/**
 * Permission foundation (master doc §13/§14). Deliberately small — this is
 * the scaffold for "Role -> Permissions" authorization, not an attempt to
 * model every future permission. Add new permissions here and extend
 * ROLE_PERMISSIONS; do not scatter new role checks across controllers.
 *
 * SUPER_ADMIN is platform administration, not clinical access (§14) — note
 * that it is NOT granted every permission automatically. Its entry below is
 * explicit, and deliberately excludes every patient/appointment/queue/
 * clinical/financial permission. SUPER_ADMIN DOES get department/doctor/
 * medicine/labtest/service permissions — catalog and org-structure data is
 * judged platform-administration-adjacent the same way Users/Hospitals are,
 * not clinical or financial data about a specific patient. See
 * /SECURITY.md and /DECISIONS.md for exactly where that line falls.
 *
 * Phase 4 also narrows clinical access below what Phase 3's generic
 * "clinical operational staff" grouping allowed (master doc §10/§52):
 * RECEPTIONIST never gets clinical documentation permissions, NURSE gets
 * only vitals (not notes/diagnosis/prescriptions), and HOSPITAL_ADMIN gets
 * financial and catalog administration but — like SUPER_ADMIN — no access
 * to clinical records at all (encounters, notes, diagnoses, prescriptions,
 * lab orders/results). An administrative role is not a clinical role.
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
  /** Covers call-next/skip/requeue/start-consultation/complete/cancel — one permission, not six (§13: don't model hundreds prematurely). */
  QUEUE_OPERATE: 'queue.operate',

  // --- Phase 4: Clinical -----------------------------------------------
  ENCOUNTER_READ: 'encounter.read',
  /** Covers create/update/complete — a DOCTOR action end to end. */
  ENCOUNTER_MANAGE: 'encounter.manage',
  VITALS_CREATE: 'vitals.create',
  CLINICAL_NOTE_CREATE: 'clinical_note.create',
  /** Covers create/update-while-draft/finalize/amend. */
  DIAGNOSIS_MANAGE: 'diagnosis.manage',
  /** Covers create/update-while-draft/finalize/amend. */
  PRESCRIPTION_MANAGE: 'prescription.manage',
  PRESCRIPTION_READ: 'prescription.read',

  // --- Phase 4: Laboratory -----------------------------------------------
  LABTEST_READ: 'labtest.read',
  LABTEST_MANAGE: 'labtest.manage',
  LAB_ORDER_CREATE: 'lab_order.create',
  LAB_ORDER_READ: 'lab_order.read',
  /** Specimen collection + order/item status transitions — lab operations, not clinical authorship. */
  LAB_ORDER_PROCESS: 'lab_order.process',
  LAB_RESULT_ENTER: 'lab_result.enter',
  /** Deliberately separate from ENTER — verifying is a maker-checker action (§32), enforced to require a different user than the enterer. */
  LAB_RESULT_VERIFY: 'lab_result.verify',
  LAB_RESULT_READ: 'lab_result.read',

  // --- Phase 4: Pharmacy -----------------------------------------------
  MEDICINE_READ: 'medicine.read',
  MEDICINE_MANAGE: 'medicine.manage',
  INVENTORY_READ: 'inventory.read',
  INVENTORY_MANAGE: 'inventory.manage',
  PHARMACY_DISPENSE: 'pharmacy.dispense',

  // --- Phase 4: Billing & Payments ---------------------------------------
  SERVICE_READ: 'service.read',
  SERVICE_MANAGE: 'service.manage',
  INVOICE_READ: 'invoice.read',
  /** Covers create + issue. */
  INVOICE_MANAGE: 'invoice.manage',
  PAYMENT_READ: 'payment.read',
  PAYMENT_MANAGE: 'payment.manage',
  /** Deliberately separate and narrower than PAYMENT_MANAGE — refunds are more sensitive (§49). */
  PAYMENT_REFUND: 'payment.refund',
} as const;

export type PermissionType = (typeof Permission)[keyof typeof Permission];

/** Platform/org-structure administration: Hospital, User, Department, Doctor roster, and every catalog (medicine/labtest/service) — never anything patient-specific. */
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
  Permission.LABTEST_READ,
  Permission.LABTEST_MANAGE,
  Permission.MEDICINE_READ,
  Permission.MEDICINE_MANAGE,
  Permission.SERVICE_READ,
  Permission.SERVICE_MANAGE,
];

/** Baseline front-desk workflow shared by NURSE/RECEPTIONIST/DOCTOR: patient registration, appointments, queue. No clinical documentation. */
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

const HOSPITAL_ADMIN_PERMISSIONS: PermissionType[] = [
  Permission.HOSPITAL_READ,
  Permission.USER_READ,
  Permission.USER_CREATE,
  Permission.USER_UPDATE,
  Permission.USER_DEACTIVATE,
  ...CLINICAL_OPERATIONAL_PERMISSIONS,
  Permission.DEPARTMENT_CREATE,
  Permission.DEPARTMENT_UPDATE,
  Permission.DOCTOR_CREATE,
  Permission.DOCTOR_UPDATE,
  Permission.DOCTOR_SCHEDULE_MANAGE,
  // Catalog + inventory + financial administration — operational, not
  // clinical. No ENCOUNTER_*/VITALS_*/CLINICAL_NOTE_*/DIAGNOSIS_*/
  // PRESCRIPTION_*/LAB_ORDER_*/LAB_RESULT_* here on purpose (§10/§52): an
  // administrator does not get clinical-record access merely by being an
  // administrator, same principle already applied to SUPER_ADMIN.
  Permission.LABTEST_MANAGE,
  Permission.LABTEST_READ,
  Permission.MEDICINE_MANAGE,
  Permission.MEDICINE_READ,
  Permission.INVENTORY_MANAGE,
  Permission.INVENTORY_READ,
  Permission.SERVICE_MANAGE,
  Permission.SERVICE_READ,
  Permission.INVOICE_MANAGE,
  Permission.INVOICE_READ,
  Permission.PAYMENT_MANAGE,
  Permission.PAYMENT_READ,
  Permission.PAYMENT_REFUND,
];

const DOCTOR_PERMISSIONS: PermissionType[] = [
  ...CLINICAL_OPERATIONAL_PERMISSIONS,
  // A DOCTOR may manage only their own schedule — enforced at the service
  // layer (ownership check), not by a separate permission, same pattern as
  // other "own resource" rules in this codebase.
  Permission.DOCTOR_SCHEDULE_MANAGE,
  Permission.ENCOUNTER_READ,
  Permission.ENCOUNTER_MANAGE,
  Permission.VITALS_CREATE,
  Permission.CLINICAL_NOTE_CREATE,
  Permission.DIAGNOSIS_MANAGE,
  Permission.PRESCRIPTION_MANAGE,
  Permission.PRESCRIPTION_READ,
  Permission.LAB_ORDER_CREATE,
  Permission.LAB_ORDER_READ,
  Permission.LAB_RESULT_READ,
  Permission.LABTEST_READ,
  Permission.MEDICINE_READ,
];

/** NURSE: front-desk workflow plus vitals only — not notes, diagnosis, or prescriptions (master doc §52: "Nurse: vital signs where permitted"). */
const NURSE_PERMISSIONS: PermissionType[] = [
  ...CLINICAL_OPERATIONAL_PERMISSIONS,
  Permission.ENCOUNTER_READ,
  Permission.VITALS_CREATE,
];

/** RECEPTIONIST: front-desk workflow plus billing front-desk duties (master doc §51: "create/view appropriate invoices") — no clinical access at all, no refunds. */
const RECEPTIONIST_PERMISSIONS: PermissionType[] = [
  ...CLINICAL_OPERATIONAL_PERMISSIONS,
  Permission.INVOICE_READ,
  Permission.INVOICE_MANAGE,
  Permission.PAYMENT_READ,
  Permission.PAYMENT_MANAGE,
];

const PHARMACIST_PERMISSIONS: PermissionType[] = [
  Permission.PATIENT_READ,
  Permission.PRESCRIPTION_READ,
  Permission.MEDICINE_READ,
  Permission.MEDICINE_MANAGE,
  Permission.INVENTORY_READ,
  Permission.INVENTORY_MANAGE,
  Permission.PHARMACY_DISPENSE,
];

const LAB_TECHNICIAN_PERMISSIONS: PermissionType[] = [
  Permission.PATIENT_READ,
  Permission.LABTEST_READ,
  Permission.LAB_ORDER_READ,
  Permission.LAB_ORDER_PROCESS,
  Permission.LAB_RESULT_ENTER,
  Permission.LAB_RESULT_VERIFY,
  Permission.LAB_RESULT_READ,
];

const ACCOUNTANT_PERMISSIONS: PermissionType[] = [
  Permission.PATIENT_READ,
  Permission.SERVICE_READ,
  Permission.SERVICE_MANAGE,
  Permission.INVOICE_READ,
  Permission.INVOICE_MANAGE,
  Permission.PAYMENT_READ,
  Permission.PAYMENT_MANAGE,
  Permission.PAYMENT_REFUND,
];

/**
 * Every role's permission set is listed explicitly — none are inherited
 * implicitly from another role. Role.PATIENT (a login role, reserved for
 * Phase 5 patient self-service / HospitalOS Connect — not to be confused
 * with the Patient clinical entity) gets zero permissions here; this phase
 * builds no patient-facing operational endpoints (§3, §34/§55 deferred).
 */
export const ROLE_PERMISSIONS: Record<Role, PermissionType[]> = {
  [Role.SUPER_ADMIN]: PLATFORM_ADMIN_PERMISSIONS,
  [Role.HOSPITAL_ADMIN]: HOSPITAL_ADMIN_PERMISSIONS,
  [Role.DOCTOR]: DOCTOR_PERMISSIONS,
  [Role.NURSE]: NURSE_PERMISSIONS,
  [Role.RECEPTIONIST]: RECEPTIONIST_PERMISSIONS,
  [Role.PHARMACIST]: PHARMACIST_PERMISSIONS,
  [Role.LAB_TECHNICIAN]: LAB_TECHNICIAN_PERMISSIONS,
  [Role.ACCOUNTANT]: ACCOUNTANT_PERMISSIONS,
  [Role.PATIENT]: [],
};

export function roleHasPermission(role: Role, permission: PermissionType): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
