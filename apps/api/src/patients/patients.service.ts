import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Patient, Prisma } from '@prisma/client';
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

    const patient = await this.prisma.$transaction(async (tx) => {
      // Atomic per-hospital counter: a single UPDATE ... increment is
      // row-locked by Postgres, so concurrent registrations for the same
      // hospital serialize here and never hand out the same MRN twice.
      // See /DATABASE.md and the concurrency test in test/patients.e2e-spec.ts.
      const hospital = await tx.hospital.update({
        where: { id: actor.hospitalId! },
        data: { mrnSequence: { increment: 1 } },
      });

      const mrn = `${hospital.code}-${String(hospital.mrnSequence).padStart(MRN_SEQUENCE_PAD_LENGTH, '0')}`;

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

  private async getTenantScopedPatientOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Patient> {
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
