import { HttpStatus, Injectable } from '@nestjs/common';
import { Appointment, AppointmentStatus, AuditOutcome, DoctorStatus, Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { getZonedDateParts, zonedWallTimeToUtc } from '../common/utils/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { PatientsService } from '../patients/patients.service';
import { DoctorsService } from '../doctors/doctors.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentQueryDto } from './dto/appointment-query.dto';
import {
  AppointmentResponseDto,
  PaginatedAppointmentsResponseDto,
} from './dto/appointment-response.dto';

/**
 * Explicit state machine (master doc §31/§32) — the single source of truth
 * for which transitions are legal. CHECKED_IN exists in the enum for future
 * granularity but is unreachable via Phase 3 endpoints: the check-in action
 * lives in queue.service.ts (POST /queue-entries) and moves an appointment
 * straight from SCHEDULED/CONFIRMED to IN_QUEUE, creating the QueueEntry in
 * the same transaction — see /DECISIONS.md.
 */
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'IN_QUEUE', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_QUEUE', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_QUEUE'],
  IN_QUEUE: ['IN_CONSULTATION', 'CANCELLED'],
  IN_CONSULTATION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const RESCHEDULABLE_STATUSES: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED'];
const CANCELLABLE_STATUSES: AppointmentStatus[] = [
  'SCHEDULED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_QUEUE',
];

export function assertTransitionAllowed(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new AppException(
      'INVALID_APPOINTMENT_TRANSITION',
      `Cannot move an appointment from ${from} to ${to}.`,
      HttpStatus.CONFLICT,
    );
  }
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly patientsService: PatientsService,
    private readonly doctorsService: DoctorsService,
  ) {}

  async create(
    dto: CreateAppointmentDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<AppointmentResponseDto> {
    // Appointments touch a specific patient — same exclusion as Patients
    // itself (§14): no SUPER_ADMIN bypass, platform administration never
    // implies clinical/operational access.
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }

    const patient = await this.patientsService.getTenantScopedPatientOrThrow(dto.patientId, actor);
    if (!patient.isActive) {
      throw new AppException(
        'PATIENT_INACTIVE',
        'Cannot book an appointment for an inactive patient.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const doctor = await this.doctorsService.getTenantScopedDoctorOrThrow(
      dto.doctorProfileId,
      actor,
    );
    if (doctor.hospitalId !== actor.hospitalId) {
      throw new AppException('DOCTOR_NOT_FOUND', 'Doctor not found.', HttpStatus.NOT_FOUND);
    }
    if (doctor.status !== DoctorStatus.ACTIVE) {
      throw new AppException(
        'DOCTOR_INACTIVE',
        'Cannot book an appointment with an inactive doctor.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt.getTime() <= Date.now()) {
      throw new AppException(
        'APPOINTMENT_IN_PAST',
        'Cannot book an appointment in the past.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Re-derives the exact same availability computation used by
    // GET /doctors/:id/available-slots — one source of truth for schedule +
    // unavailability + existing-booking conflicts, rather than duplicating
    // that logic here (master doc §77).
    const hospitalDate = getZonedDateParts(
      (await this.prisma.hospital.findUniqueOrThrow({ where: { id: actor.hospitalId } })).timezone,
      scheduledAt,
    ).date;
    const availableSlots = await this.doctorsService.getAvailableSlots(
      doctor.id,
      hospitalDate,
      actor,
    );
    if (!availableSlots.includes(scheduledAt.toISOString())) {
      throw new AppException(
        'SLOT_NOT_AVAILABLE',
        'The requested time is not an available slot for this doctor.',
        HttpStatus.BAD_REQUEST,
      );
    }

    let appointment: Appointment;
    try {
      appointment = await this.prisma.appointment.create({
        data: {
          hospitalId: actor.hospitalId,
          patientId: patient.id,
          doctorProfileId: doctor.id,
          departmentId: doctor.departmentId,
          scheduledAt,
          durationMinutes: dto.durationMinutes ?? 15,
          reason: dto.reason,
          bookedByUserId: actor.userId,
        },
      });
    } catch (error) {
      // Race-condition backstop: the available-slots check above is a
      // point-in-time read, not a lock. If a concurrent request won the
      // race, the partial unique index (see /DATABASE.md) rejects this
      // insert — surfaced as a clean conflict, not a raw constraint error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          'SLOT_ALREADY_BOOKED',
          'This slot was just booked by someone else. Please choose another.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.auditService.log({
      action: AuditAction.APPOINTMENT_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId,
      resourceType: 'Appointment',
      resourceId: appointment.id,
      correlationId,
    });

    return this.toResponse(appointment);
  }

  async findAllForTenant(
    actor: AuthenticatedUser,
    query: AppointmentQueryDto,
  ): Promise<PaginatedAppointmentsResponseDto> {
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }

    const where: Prisma.AppointmentWhereInput = { hospitalId: actor.hospitalId };
    if (query.doctorId) where.doctorProfileId = query.doctorId;
    if (query.patientId) where.patientId = query.patientId;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.status) where.status = query.status;
    if (query.date) {
      const hospital = await this.prisma.hospital.findUniqueOrThrow({
        where: { id: actor.hospitalId },
      });
      const dayStart = zonedWallTimeToUtc(hospital.timezone, query.date, '00:00');
      const next = new Date(`${query.date}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const dayEnd = zonedWallTimeToUtc(
        hospital.timezone,
        next.toISOString().slice(0, 10),
        '00:00',
      );
      where.scheduledAt = { gte: dayStart, lt: dayEnd };
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        orderBy: { scheduledAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { items: items.map((a) => this.toResponse(a)), total, page, pageSize };
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<AppointmentResponseDto> {
    const appointment = await this.getTenantScopedAppointmentOrThrow(id, actor);
    return this.toResponse(appointment);
  }

  async update(
    id: string,
    dto: UpdateAppointmentDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<AppointmentResponseDto> {
    const appointment = await this.getTenantScopedAppointmentOrThrow(id, actor);
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appointment.status)) {
      throw new AppException(
        'APPOINTMENT_NOT_EDITABLE',
        `Cannot edit an appointment in status ${appointment.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { reason: dto.reason },
    });

    await this.auditService.log({
      action: AuditAction.APPOINTMENT_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'Appointment',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  async cancel(
    id: string,
    dto: CancelAppointmentDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<AppointmentResponseDto> {
    const appointment = await this.getTenantScopedAppointmentOrThrow(id, actor);
    if (!CANCELLABLE_STATUSES.includes(appointment.status)) {
      assertTransitionAllowed(appointment.status, 'CANCELLED');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: actor.userId,
          cancellationReason: dto.reason,
        },
      });
      // Keep a linked queue entry consistent rather than leaving an
      // orphaned WAITING/CALLED entry for a cancelled appointment.
      await tx.queueEntry.updateMany({
        where: { appointmentId: appointment.id, status: { in: ['WAITING', 'CALLED'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      return result;
    });

    await this.auditService.log({
      action: AuditAction.APPOINTMENT_CANCELLED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'Appointment',
      resourceId: updated.id,
      correlationId,
      metadata: { reason: dto.reason },
    });

    return this.toResponse(updated);
  }

  async reschedule(
    id: string,
    dto: RescheduleAppointmentDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<AppointmentResponseDto> {
    const original = await this.getTenantScopedAppointmentOrThrow(id, actor);
    if (!RESCHEDULABLE_STATUSES.includes(original.status)) {
      throw new AppException(
        'APPOINTMENT_NOT_RESCHEDULABLE',
        `Cannot reschedule an appointment in status ${original.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const newScheduledAt = new Date(dto.scheduledAt);
    if (newScheduledAt.getTime() <= Date.now()) {
      throw new AppException(
        'APPOINTMENT_IN_PAST',
        'Cannot reschedule to a time in the past.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const hospital = await this.prisma.hospital.findUniqueOrThrow({
      where: { id: actor.hospitalId! },
    });
    const hospitalDate = getZonedDateParts(hospital.timezone, newScheduledAt).date;
    const availableSlots = await this.doctorsService.getAvailableSlots(
      original.doctorProfileId,
      hospitalDate,
      actor,
    );
    if (!availableSlots.includes(newScheduledAt.toISOString())) {
      throw new AppException(
        'SLOT_NOT_AVAILABLE',
        'The requested time is not an available slot for this doctor.',
        HttpStatus.BAD_REQUEST,
      );
    }

    let created: Appointment;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: original.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledByUserId: actor.userId,
            cancellationReason: 'RESCHEDULED',
          },
        });
        return tx.appointment.create({
          data: {
            hospitalId: original.hospitalId,
            patientId: original.patientId,
            doctorProfileId: original.doctorProfileId,
            departmentId: original.departmentId,
            scheduledAt: newScheduledAt,
            durationMinutes: original.durationMinutes,
            reason: original.reason,
            bookedByUserId: actor.userId,
            rescheduledFromId: original.id,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          'SLOT_ALREADY_BOOKED',
          'This slot was just booked by someone else. Please choose another.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.auditService.log({
      action: AuditAction.APPOINTMENT_RESCHEDULED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'Appointment',
      resourceId: created.id,
      correlationId,
      metadata: {
        fromAppointmentId: original.id,
        oldScheduledAt: original.scheduledAt,
        newScheduledAt,
      },
    });

    return this.toResponse(created);
  }

  async markNoShow(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<AppointmentResponseDto> {
    const appointment = await this.getTenantScopedAppointmentOrThrow(id, actor);
    assertTransitionAllowed(appointment.status, 'NO_SHOW');
    if (appointment.scheduledAt.getTime() > Date.now()) {
      throw new AppException(
        'APPOINTMENT_NOT_YET_DUE',
        'Cannot mark a future appointment as a no-show.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'NO_SHOW' },
    });

    await this.auditService.log({
      action: AuditAction.APPOINTMENT_NO_SHOW,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'Appointment',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  /** Used by queue.service.ts to validate/transition an appointment reference. */
  async getTenantScopedAppointmentOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Appointment> {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      throw new AppException(
        'APPOINTMENT_NOT_FOUND',
        'Appointment not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    assertSameTenantStrict(
      appointment.hospitalId,
      actor,
      'APPOINTMENT_NOT_FOUND',
      'Appointment not found.',
    );
    return appointment;
  }

  private toResponse(appointment: Appointment): AppointmentResponseDto {
    return {
      id: appointment.id,
      hospitalId: appointment.hospitalId,
      patientId: appointment.patientId,
      doctorProfileId: appointment.doctorProfileId,
      departmentId: appointment.departmentId,
      scheduledAt: appointment.scheduledAt,
      durationMinutes: appointment.durationMinutes,
      status: appointment.status,
      reason: appointment.reason,
      cancelledAt: appointment.cancelledAt,
      cancellationReason: appointment.cancellationReason,
      rescheduledFromId: appointment.rescheduledFromId,
      bookedByUserId: appointment.bookedByUserId,
      createdAt: appointment.createdAt,
      updatedAt: appointment.updatedAt,
    };
  }
}
