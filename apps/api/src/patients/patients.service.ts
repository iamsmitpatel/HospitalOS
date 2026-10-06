import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Gender, Patient, Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientQueryDto } from './dto/patient-query.dto';
import { PaginatedPatientsResponseDto, PatientResponseDto } from './dto/patient-response.dto';

const MRN_SEQUENCE_PAD_LENGTH = 6;

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreatePatientDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<PatientResponseDto> {
    // SUPER_ADMIN is a platform-level role with no hospital of its own — there
    // is no legitimate "register a patient on behalf of hospital X" flow for
    // it in Phase 1B, unlike user creation. See /DECISIONS.md.
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital and cannot register a patient.',
        HttpStatus.FORBIDDEN,
      );
    }

    const dateOfBirth = this.parseAndValidateDateOfBirth(dto.dateOfBirth);

    // Duplicate-registration prevention (master doc §22): names are never
    // used as a matching indicator (not unique), and a match never
    // auto-merges or auto-blocks — it surfaces as a confirmable warning.
    // phone + dateOfBirth together is a reasonable, configurable indicator;
    // not a definitive identity match.
    if (!dto.confirmDuplicate) {
      const possibleDuplicate = await this.prisma.patient.findFirst({
        where: { hospitalId: actor.hospitalId, isActive: true, phone: dto.phone, dateOfBirth },
      });
      if (possibleDuplicate) {
        throw new AppException(
          'POTENTIAL_DUPLICATE_PATIENT',
          `A patient with this phone number and date of birth is already registered (MRN: ${possibleDuplicate.mrn}). Set confirmDuplicate: true to register anyway.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const patient = await this.prisma.$transaction(async (tx) => {
      const mrn = await this.nextMrn(tx, actor.hospitalId!);

      return tx.patient.create({
        data: {
          hospitalId: actor.hospitalId!,
          mrn,
          firstName: dto.firstName,
          lastName: dto.lastName,
          dateOfBirth,
          gender: dto.gender,
          phone: dto.phone,
          email: dto.email,
          addressLine: dto.addressLine,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          registeredByUserId: actor.userId,
        },
      });
    });

    await this.auditService.log({
      action: AuditAction.PATIENT_REGISTERED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: patient.hospitalId,
      resourceType: 'Patient',
      resourceId: patient.id,
      correlationId,
    });

    return this.toResponse(patient);
  }

  async findAllForTenant(
    actor: AuthenticatedUser,
    query: PatientQueryDto,
  ): Promise<PaginatedPatientsResponseDto> {
    // Unlike Users/Hospitals, SUPER_ADMIN does NOT get a platform-wide bypass
    // here: clinical data is never implicitly visible to a platform
    // administrator just because they administer the platform (§14 — platform
    // administration and clinical access are deliberately separate). Every
    // caller, SUPER_ADMIN included, must have a hospital context to see patients.
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }
    const where: Prisma.PatientWhereInput = { hospitalId: actor.hospitalId };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { mrn: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.patient.count({ where }),
    ]);

    return {
      items: items.map((p) => this.toResponse(p)),
      total,
      page,
      pageSize,
    };
  }

  async findOneForTenant(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<PatientResponseDto> {
    const patient = await this.getTenantScopedPatientOrThrow(id, actor);

    await this.auditService.log({
      action: AuditAction.PATIENT_ACCESSED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: patient.hospitalId,
      resourceType: 'Patient',
      resourceId: patient.id,
      correlationId,
    });

    return this.toResponse(patient);
  }

  async update(
    id: string,
    dto: UpdatePatientDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<PatientResponseDto> {
    const existing = await this.getTenantScopedPatientOrThrow(id, actor);

    const dateOfBirth = dto.dateOfBirth
      ? this.parseAndValidateDateOfBirth(dto.dateOfBirth)
      : undefined;

    const updated = await this.prisma.patient.update({
      where: { id: existing.id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth,
        gender: dto.gender,
        phone: dto.phone,
        email: dto.email,
        addressLine: dto.addressLine,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        isActive: dto.isActive,
      },
    });

    await this.auditService.log({
      action: AuditAction.PATIENT_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'Patient',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  private parseAndValidateDateOfBirth(value: string): Date {
    const date = new Date(value);
    if (date.getTime() > Date.now()) {
      throw new AppException(
        'INVALID_DATE_OF_BIRTH',
        'Date of birth cannot be in the future.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return date;
  }

  /** Public so appointments.service.ts / queue.service.ts can validate a patient reference without duplicating this check. */
  async getTenantScopedPatientOrThrow(id: string, actor: AuthenticatedUser): Promise<Patient> {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    // 404 (not 403) for cross-tenant access, same reasoning as users/hospitals
    // (§9, §30): never confirm a patient exists in a tenant the caller can't see.
    // No SUPER_ADMIN bypass here (see findAllForTenant) — clinical access is
    // never implicit for a platform administrator.
    if (!patient || patient.hospitalId !== actor.hospitalId) {
      throw new AppException('PATIENT_NOT_FOUND', 'Patient not found.', HttpStatus.NOT_FOUND);
    }
    return patient;
  }

  /**
   * HospitalOS Connect (Phase 5): resolves the clinical Patient record for a
   * given (hospital, Connect user) pair, auto-creating one on first contact
   * with that hospital — e.g. the patient's first-ever booking there — using
   * the Connect account's own demographic fields as the initial values
   * (independently editable per-hospital afterward, same as any other
   * Patient record). Reuses the exact same atomic MRN-sequence mechanism as
   * staff registration via create() above — see nextMrn().
   */
  async getOrCreateForConnectUser(
    hospitalId: string,
    connectUser: {
      id: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      dateOfBirth: Date | null;
      gender: Gender | null;
      email: string;
    },
    correlationId?: string,
  ): Promise<Patient> {
    const existing = await this.prisma.patient.findFirst({
      where: { hospitalId, userId: connectUser.id },
    });
    if (existing) {
      return existing;
    }

    if (!connectUser.phone || !connectUser.dateOfBirth || !connectUser.gender) {
      throw new AppException(
        'PATIENT_PROFILE_INCOMPLETE',
        'Complete your profile (phone, date of birth, gender) before booking.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const patient = await this.prisma.$transaction(async (tx) => {
      const mrn = await this.nextMrn(tx, hospitalId);
      return tx.patient.create({
        data: {
          hospitalId,
          mrn,
          firstName: connectUser.firstName,
          lastName: connectUser.lastName,
          dateOfBirth: connectUser.dateOfBirth!,
          gender: connectUser.gender!,
          phone: connectUser.phone!,
          email: connectUser.email,
          registeredByUserId: connectUser.id,
          userId: connectUser.id,
        },
      });
    });

    await this.auditService.log({
      action: AuditAction.PATIENT_RECORD_LINKED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: connectUser.id,
      hospitalId,
      resourceType: 'Patient',
      resourceId: patient.id,
      correlationId,
      metadata: { reason: 'connect_auto_created' },
    });

    return patient;
  }

  /**
   * Links an EXISTING clinical record (created by hospital staff before
   * this patient ever had a Connect account) to the caller's own identity —
   * an explicit, server-validated claim (exact MRN + DOB + phone match),
   * never implicit. See /SECURITY.md ("never accept patientId from the
   * frontend and trust it") — the caller never supplies a patientId here at
   * all, only the identifying details a legitimate owner would know.
   */
  async claimExistingRecord(
    connectUser: { id: string },
    claim: { hospitalId: string; mrn: string; dateOfBirth: string; phone: string },
    correlationId?: string,
  ): Promise<Patient> {
    const dateOfBirth = this.parseAndValidateDateOfBirth(claim.dateOfBirth);
    const patient = await this.prisma.patient.findUnique({
      where: { hospitalId_mrn: { hospitalId: claim.hospitalId, mrn: claim.mrn } },
    });
    // Deliberately one generic error for "no such record," "already
    // claimed by someone else," and "details don't match" — never lets a
    // caller distinguish which case applies, same discipline as login's
    // generic INVALID_CREDENTIALS (§ "never return different sensitive
    // errors that allow an attacker to enumerate accounts").
    if (
      !patient ||
      patient.userId !== null ||
      patient.dateOfBirth.getTime() !== dateOfBirth.getTime() ||
      patient.phone !== claim.phone
    ) {
      throw new AppException(
        'PATIENT_RECORD_CLAIM_FAILED',
        'Could not match a patient record with the details provided.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Atomic, conditional write — not a plain update() — because the check
    // above and this write are two separate round-trips. Without the
    // `userId: null` guard here, two concurrent claims that both read the
    // record as unclaimed (e.g. two family members who both know the
    // patient's DOB/phone) could both pass the check above, and whichever
    // update() ran last would silently steal the link from the other. This
    // way, only the request that lands first flips 0 -> 1 row; the loser
    // gets `count === 0` and the same generic failure as any other
    // mismatch, never a confusing "it worked" followed by someone else
    // actually owning the record.
    const result = await this.prisma.patient.updateMany({
      where: { id: patient.id, userId: null },
      data: { userId: connectUser.id },
    });
    if (result.count === 0) {
      throw new AppException(
        'PATIENT_RECORD_CLAIM_FAILED',
        'Could not match a patient record with the details provided.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const updated = await this.prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });

    await this.auditService.log({
      action: AuditAction.PATIENT_RECORD_LINKED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: connectUser.id,
      hospitalId: claim.hospitalId,
      resourceType: 'Patient',
      resourceId: updated.id,
      correlationId,
      metadata: { reason: 'connect_claimed_existing' },
    });

    return updated;
  }

  /** Every Patient record linked to this Connect account, across every hospital they've visited. */
  async listForConnectUser(connectUserId: string): Promise<PatientResponseDto[]> {
    const patients = await this.prisma.patient.findMany({
      where: { userId: connectUserId },
      orderBy: { createdAt: 'desc' },
    });
    return patients.map((p) => this.toResponse(p));
  }

  /** Used by connect/ services to validate a patientId belongs to the calling Connect user — never a hospital-staff tenant check. */
  async getOwnPatientRecordOrThrow(id: string, connectUserId: string): Promise<Patient> {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient || patient.userId !== connectUserId) {
      throw new AppException(
        'PATIENT_NOT_FOUND',
        'Patient record not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return patient;
  }

  /** Lets connect/ controllers shape a single raw Patient row (from claimExistingRecord, getOrCreateForConnectUser, getOwnPatientRecordOrThrow) without duplicating the field list. */
  toPatientResponseDto(patient: Patient): PatientResponseDto {
    return this.toResponse(patient);
  }

  private async nextMrn(tx: Pick<PrismaService, 'hospital'>, hospitalId: string): Promise<string> {
    // Atomic per-hospital counter: a single UPDATE ... increment is
    // row-locked by Postgres, so concurrent registrations for the same
    // hospital serialize here and never hand out the same MRN twice.
    // See /DATABASE.md.
    const hospital = await tx.hospital.update({
      where: { id: hospitalId },
      data: { mrnSequence: { increment: 1 } },
    });
    return `${hospital.code}-${String(hospital.mrnSequence).padStart(MRN_SEQUENCE_PAD_LENGTH, '0')}`;
  }

  private toResponse(patient: Patient): PatientResponseDto {
    return {
      id: patient.id,
      hospitalId: patient.hospitalId,
      mrn: patient.mrn,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      phone: patient.phone,
      email: patient.email,
      addressLine: patient.addressLine,
      emergencyContactName: patient.emergencyContactName,
      emergencyContactPhone: patient.emergencyContactPhone,
      isActive: patient.isActive,
      registeredByUserId: patient.registeredByUserId,
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    };
  }
}
