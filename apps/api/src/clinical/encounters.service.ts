import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, DoctorProfile, Encounter, Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CreateEncounterDto } from './dto/create-encounter.dto';
import { EncounterQueryDto } from './dto/encounter-query.dto';
import { EncounterResponseDto, PaginatedEncountersResponseDto } from './dto/encounter-response.dto';

/**
 * A fresh encounter is created IN_PROGRESS (master doc §9) — OPEN exists in
 * the enum for future granularity but is unreachable via these endpoints,
 * same pattern as Appointment's unreachable CHECKED_IN (see
 * appointments.service.ts).
 */
export function assertEncounterNotCancelled(encounter: Encounter): void {
  if (encounter.status === 'CANCELLED') {
    throw new AppException(
      'ENCOUNTER_CANCELLED',
      'This encounter was cancelled; no further clinical records can be added to it.',
      HttpStatus.CONFLICT,
    );
  }
}

@Injectable()
export class EncountersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly patientsService: PatientsService,
    private readonly doctorsService: DoctorsService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async create(
    dto: CreateEncounterDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<EncounterResponseDto> {
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }

    // ENCOUNTER_MANAGE is a DOCTOR-only permission (see
    // permissions.constants.ts), but the doctorProfileId is still always
    // resolved server-side from the actor, never trusted from the request
    // body — the same principle as assertCanManageSchedule in
    // doctors.service.ts, applied at resolution time instead of after.
    const doctor = await this.doctorsService.getOwnDoctorProfileOrThrow(actor);

    let patientId: string;
    let departmentId: string;
    let appointmentId: string | null = null;

    if (dto.appointmentId) {
      const appointment = await this.appointmentsService.getTenantScopedAppointmentOrThrow(
        dto.appointmentId,
        actor,
      );
      if (appointment.doctorProfileId !== doctor.id) {
        throw new AppException(
          'FORBIDDEN',
          'You can only start an encounter for your own appointment.',
          HttpStatus.FORBIDDEN,
        );
      }
      // The queue module already drives SCHEDULED/CONFIRMED -> IN_QUEUE ->
      // IN_CONSULTATION (queue.service.ts startConsultation) by the time a
      // doctor is actually with the patient — this is also what guarantees
      // appointment.patientId/departmentId are safe to trust here instead of
      // re-deriving them from the request body (master doc §9).
      if (appointment.status !== 'IN_CONSULTATION') {
        throw new AppException(
          'APPOINTMENT_NOT_IN_CONSULTATION',
          `Cannot start an encounter for an appointment in status ${appointment.status}. The patient must be called and started from the queue first.`,
          HttpStatus.CONFLICT,
        );
      }
      patientId = appointment.patientId;
      departmentId = appointment.departmentId;
      appointmentId = appointment.id;
    } else {
      if (!dto.patientId) {
        throw new AppException(
          'PATIENT_ID_REQUIRED',
          'patientId is required for a walk-in encounter (no appointmentId).',
          HttpStatus.BAD_REQUEST,
        );
      }
      const patient = await this.patientsService.getTenantScopedPatientOrThrow(
        dto.patientId,
        actor,
      );
      if (!patient.isActive) {
        throw new AppException(
          'PATIENT_INACTIVE',
          'Cannot start an encounter for an inactive patient.',
          HttpStatus.BAD_REQUEST,
        );
      }
      patientId = patient.id;
      departmentId = doctor.departmentId;
    }

    let encounter: Encounter;
    try {
      encounter = await this.prisma.encounter.create({
        data: {
          hospitalId: actor.hospitalId!,
          patientId,
          doctorProfileId: doctor.id,
          departmentId,
          appointmentId,
        },
      });
    } catch (error) {
      // Encounter.appointmentId is unique — a concurrent request that won
      // the race surfaces as a clean conflict instead of a raw constraint
      // error, same backstop pattern as appointments.service.ts create().
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          'ENCOUNTER_ALREADY_EXISTS',
          'An encounter already exists for this appointment.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.auditService.log({
      action: AuditAction.ENCOUNTER_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId,
      resourceType: 'Encounter',
      resourceId: encounter.id,
      correlationId,
    });

    return this.toResponse(encounter);
  }

  async findAllForTenant(
    actor: AuthenticatedUser,
    query: EncounterQueryDto,
  ): Promise<PaginatedEncountersResponseDto> {
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }

    const where = {
      hospitalId: actor.hospitalId,
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.doctorProfileId ? { doctorProfileId: query.doctorProfileId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.encounter.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.encounter.count({ where }),
    ]);

    return { items: items.map((e) => this.toResponse(e)), total, page, pageSize };
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<EncounterResponseDto> {
    const encounter = await this.getTenantScopedEncounterOrThrow(id, actor);
    return this.toResponse(encounter);
  }

  async complete(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<EncounterResponseDto> {
    const encounter = await this.getTenantScopedEncounterOrThrow(id, actor);
    await this.assertOwnEncounter(encounter, actor);
    if (encounter.status !== 'IN_PROGRESS') {
      throw new AppException(
        'ENCOUNTER_NOT_IN_PROGRESS',
        `Cannot complete an encounter in status ${encounter.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.encounter.update({
        where: { id: encounter.id },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
      if (encounter.appointmentId) {
        // Best-effort consistency side-effect, same pattern as
        // appointments.service.ts cancel() for queue entries — a mismatch
        // here (appointment not currently IN_CONSULTATION) silently no-ops
        // rather than blocking the clinical completion.
        await tx.appointment.updateMany({
          where: { id: encounter.appointmentId, status: 'IN_CONSULTATION' },
          data: { status: 'COMPLETED' },
        });
      }
      return result;
    });

    await this.auditService.log({
      action: AuditAction.ENCOUNTER_COMPLETED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'Encounter',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  async cancel(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<EncounterResponseDto> {
    const encounter = await this.getTenantScopedEncounterOrThrow(id, actor);
    await this.assertOwnEncounter(encounter, actor);
    if (encounter.status !== 'IN_PROGRESS') {
      throw new AppException(
        'ENCOUNTER_NOT_IN_PROGRESS',
        `Cannot cancel an encounter in status ${encounter.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.encounter.update({
      where: { id: encounter.id },
      data: { status: 'CANCELLED', endedAt: new Date() },
    });

    await this.auditService.log({
      action: AuditAction.ENCOUNTER_CANCELLED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'Encounter',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  /** Used by vitals/clinical-notes/diagnoses/prescriptions services to validate an encounter reference. */
  async getTenantScopedEncounterOrThrow(id: string, actor: AuthenticatedUser): Promise<Encounter> {
    const encounter = await this.prisma.encounter.findUnique({ where: { id } });
    if (!encounter) {
      throw new AppException('ENCOUNTER_NOT_FOUND', 'Encounter not found.', HttpStatus.NOT_FOUND);
    }
    // No SUPER_ADMIN/HOSPITAL_ADMIN bypass — a clinical record, same
    // exclusion as Patient/Appointment (§14).
    assertSameTenantStrict(
      encounter.hospitalId,
      actor,
      'ENCOUNTER_NOT_FOUND',
      'Encounter not found.',
    );
    return encounter;
  }

  /** Used by diagnoses/prescriptions services — only the encounter's own doctor may author clinical records on it. */
  async assertOwnEncounter(encounter: Encounter, actor: AuthenticatedUser): Promise<DoctorProfile> {
    const doctor = await this.doctorsService.getOwnDoctorProfileOrThrow(actor);
    if (encounter.doctorProfileId !== doctor.id) {
      throw new AppException(
        'FORBIDDEN',
        'You can only act on your own encounter.',
        HttpStatus.FORBIDDEN,
      );
    }
    return doctor;
  }

  private toResponse(encounter: Encounter): EncounterResponseDto {
    return {
      id: encounter.id,
      hospitalId: encounter.hospitalId,
      patientId: encounter.patientId,
      doctorProfileId: encounter.doctorProfileId,
      departmentId: encounter.departmentId,
      appointmentId: encounter.appointmentId,
      status: encounter.status,
      startedAt: encounter.startedAt,
      endedAt: encounter.endedAt,
      createdAt: encounter.createdAt,
      updatedAt: encounter.updatedAt,
    };
  }
}
