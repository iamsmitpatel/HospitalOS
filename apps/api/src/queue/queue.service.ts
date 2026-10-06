import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Queue, QueueEntry, QueueEntryStatus } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { getZonedDateParts } from '../common/utils/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { AppointmentsService, assertTransitionAllowed } from '../appointments/appointments.service';
import { CreateQueueEntryDto } from './dto/create-queue-entry.dto';
import { QueueQueryDto } from './dto/queue-query.dto';
import { QueueDetailResponseDto, QueueResponseDto } from './dto/queue-response.dto';
import { QueueEntryResponseDto } from './dto/queue-entry-response.dto';

/**
 * QueueEntry state machine (master doc §46/§52). SKIPPED is not terminal —
 * see /DECISIONS.md: without an explicit requeue path, a skipped patient's
 * appointment (1:1 with its QueueEntry via a unique FK) would be
 * permanently stuck, since a second entry can never be created for the same
 * appointment. requeue() reuses the same row (new token, new joinedAt)
 * rather than creating a second one.
 */
const ALLOWED_TRANSITIONS: Record<QueueEntryStatus, QueueEntryStatus[]> = {
  WAITING: ['CALLED', 'SKIPPED', 'CANCELLED'],
  CALLED: ['IN_CONSULTATION', 'SKIPPED', 'CANCELLED'],
  IN_CONSULTATION: ['COMPLETED'],
  COMPLETED: [],
  SKIPPED: ['WAITING'],
  CANCELLED: [],
};

function assertEntryTransitionAllowed(from: QueueEntryStatus, to: QueueEntryStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new AppException(
      'INVALID_QUEUE_TRANSITION',
      `Cannot move a queue entry from ${from} to ${to}.`,
      HttpStatus.CONFLICT,
    );
  }
}

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /** "Check in" — creates (or reuses a SKIPPED) QueueEntry for an appointment, get-or-creating today's queue for that doctor. */
  async checkIn(
    dto: CreateQueueEntryDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<QueueEntryResponseDto> {
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }

    const appointment = await this.appointmentsService.getTenantScopedAppointmentOrThrow(
      dto.appointmentId,
      actor,
    );
    assertTransitionAllowed(appointment.status, 'IN_QUEUE');

    const existingEntry = await this.prisma.queueEntry.findUnique({
      where: { appointmentId: appointment.id },
    });
    if (existingEntry) {
      throw new AppException(
        'APPOINTMENT_ALREADY_IN_QUEUE',
        'This appointment already has a queue entry.',
        HttpStatus.CONFLICT,
      );
    }

    const hospital = await this.prisma.hospital.findUniqueOrThrow({
      where: { id: actor.hospitalId },
    });
    const queueDate = getZonedDateParts(hospital.timezone, new Date()).date;

    const entry = await this.prisma.$transaction(async (tx) => {
      const queue = await tx.queue.upsert({
        where: {
          hospitalId_doctorProfileId_queueDate: {
            hospitalId: actor.hospitalId!,
            doctorProfileId: appointment.doctorProfileId,
            queueDate: new Date(`${queueDate}T00:00:00.000Z`),
          },
        },
        update: {},
        create: {
          hospitalId: actor.hospitalId!,
          doctorProfileId: appointment.doctorProfileId,
          departmentId: appointment.departmentId,
          queueDate: new Date(`${queueDate}T00:00:00.000Z`),
        },
      });

      // Same atomic-counter pattern as Hospital.mrnSequence (§47): a single
      // row-locked UPDATE ... increment, so concurrent check-ins for the
      // same queue never collide on a token number.
      const updatedQueue = await tx.queue.update({
        where: { id: queue.id },
        data: { nextTokenNumber: { increment: 1 } },
      });
      const tokenNumber = updatedQueue.nextTokenNumber - 1;

      const created = await tx.queueEntry.create({
        data: {
          queueId: queue.id,
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          tokenNumber,
        },
      });

      await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'IN_QUEUE' } });

      return created;
    });

    await this.auditService.log({
      action: AuditAction.QUEUE_ENTRY_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId,
      resourceType: 'QueueEntry',
      resourceId: entry.id,
      correlationId,
      metadata: { tokenNumber: entry.tokenNumber },
    });

    return this.toEntryResponse(entry);
  }

  async findQueuesForTenant(
    actor: AuthenticatedUser,
    query: QueueQueryDto,
  ): Promise<QueueResponseDto[]> {
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }
    const where: Record<string, unknown> = { hospitalId: actor.hospitalId };
    if (query.doctorId) where.doctorProfileId = query.doctorId;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.date) where.queueDate = new Date(`${query.date}T00:00:00.000Z`);

    const queues = await this.prisma.queue.findMany({ where, orderBy: { queueDate: 'desc' } });
    return queues.map((q) => this.toQueueResponse(q));
  }

  async findQueueForTenant(id: string, actor: AuthenticatedUser): Promise<QueueDetailResponseDto> {
    const queue = await this.getTenantScopedQueueOrThrow(id, actor);
    const entries = await this.prisma.queueEntry.findMany({
      where: { queueId: queue.id },
      orderBy: [{ priority: 'desc' }, { joinedAt: 'asc' }],
    });
    return { ...this.toQueueResponse(queue), entries: entries.map((e) => this.toEntryResponse(e)) };
  }

  /**
   * Atomically claims the next WAITING entry (master doc §50/§80): a single
   * UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) is one
   * SQL statement, so it is race-proof without an application-level lock —
   * two concurrent callers claim two different entries when two are
   * waiting, and exactly one succeeds when only one is. See /DATABASE.md
   * and the concurrency test in test/queue-concurrency.e2e-spec.ts.
   */
  async callNext(
    queueId: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<QueueEntryResponseDto> {
    const queue = await this.getTenantScopedQueueOrThrow(queueId, actor);

    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "queue_entries"
      SET "status" = 'CALLED', "calledAt" = now(), "calledByUserId" = ${actor.userId}
      WHERE "id" = (
        SELECT "id" FROM "queue_entries"
        WHERE "queueId" = ${queue.id} AND "status" = 'WAITING'
        ORDER BY "priority" DESC, "joinedAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id"
    `;

    if (claimed.length === 0) {
      throw new AppException(
        'NO_WAITING_PATIENTS',
        'There are no patients waiting in this queue.',
        HttpStatus.CONFLICT,
      );
    }

    const entry = await this.prisma.queueEntry.findUniqueOrThrow({ where: { id: claimed[0].id } });

    await this.auditService.log({
      action: AuditAction.QUEUE_ENTRY_CALLED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: queue.hospitalId,
      resourceType: 'QueueEntry',
      resourceId: entry.id,
      correlationId,
      metadata: { tokenNumber: entry.tokenNumber },
    });

    return this.toEntryResponse(entry);
  }

  async skip(
    entryId: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.getTenantScopedEntryOrThrow(entryId, actor);
    assertEntryTransitionAllowed(entry.status, 'SKIPPED');

    const updated = await this.prisma.queueEntry.update({
      where: { id: entry.id },
      data: { status: 'SKIPPED', skippedAt: new Date() },
    });

    await this.auditService.log({
      action: AuditAction.QUEUE_ENTRY_SKIPPED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'QueueEntry',
      resourceId: updated.id,
      correlationId,
    });

    return this.toEntryResponse(updated);
  }

  /** Brings a SKIPPED entry back to WAITING with a fresh token — see the module docstring above for why this reuses the row rather than creating a new one. */
  async requeue(
    entryId: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.getTenantScopedEntryOrThrow(entryId, actor);
    assertEntryTransitionAllowed(entry.status, 'WAITING');

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedQueue = await tx.queue.update({
        where: { id: entry.queueId },
        data: { nextTokenNumber: { increment: 1 } },
      });
      return tx.queueEntry.update({
        where: { id: entry.id },
        data: {
          status: 'WAITING',
          tokenNumber: updatedQueue.nextTokenNumber - 1,
          joinedAt: new Date(),
          skippedAt: null,
        },
      });
    });

    await this.auditService.log({
      action: AuditAction.QUEUE_ENTRY_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'QueueEntry',
      resourceId: updated.id,
      correlationId,
      metadata: { requeued: true, tokenNumber: updated.tokenNumber },
    });

    return this.toEntryResponse(updated);
  }

  async startConsultation(
    entryId: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.getTenantScopedEntryOrThrow(entryId, actor);
    assertEntryTransitionAllowed(entry.status, 'IN_CONSULTATION');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.queueEntry.update({
        where: { id: entry.id },
        data: { status: 'IN_CONSULTATION' },
      });
      if (entry.appointmentId) {
        await tx.appointment.update({
          where: { id: entry.appointmentId },
          data: { status: 'IN_CONSULTATION' },
        });
      }
      return result;
    });

    await this.auditService.log({
      action: AuditAction.QUEUE_ENTRY_STARTED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'QueueEntry',
      resourceId: updated.id,
      correlationId,
    });

    return this.toEntryResponse(updated);
  }

  async complete(
    entryId: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.getTenantScopedEntryOrThrow(entryId, actor);
    assertEntryTransitionAllowed(entry.status, 'COMPLETED');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.queueEntry.update({
        where: { id: entry.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (entry.appointmentId) {
        await tx.appointment.update({
          where: { id: entry.appointmentId },
          data: { status: 'COMPLETED' },
        });
      }
      return result;
    });

    await this.auditService.log({
      action: AuditAction.QUEUE_ENTRY_COMPLETED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'QueueEntry',
      resourceId: updated.id,
      correlationId,
    });

    if (entry.appointmentId) {
      await this.auditService.log({
        action: AuditAction.APPOINTMENT_COMPLETED,
        outcome: AuditOutcome.SUCCESS,
        actorUserId: actor.userId,
        hospitalId: actor.hospitalId!,
        resourceType: 'Appointment',
        resourceId: entry.appointmentId,
        correlationId,
      });
    }

    return this.toEntryResponse(updated);
  }

  async cancel(
    entryId: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<QueueEntryResponseDto> {
    const entry = await this.getTenantScopedEntryOrThrow(entryId, actor);
    assertEntryTransitionAllowed(entry.status, 'CANCELLED');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.queueEntry.update({
        where: { id: entry.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (entry.appointmentId) {
        await tx.appointment.update({
          where: { id: entry.appointmentId },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: actor.userId },
        });
      }
      return result;
    });

    await this.auditService.log({
      action: AuditAction.QUEUE_ENTRY_CANCELLED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId!,
      resourceType: 'QueueEntry',
      resourceId: updated.id,
      correlationId,
    });

    return this.toEntryResponse(updated);
  }

  // ---------------------------------------------------------------------

  private async getTenantScopedQueueOrThrow(id: string, actor: AuthenticatedUser): Promise<Queue> {
    const queue = await this.prisma.queue.findUnique({ where: { id } });
    // No SUPER_ADMIN bypass — a live patient queue is operational/clinical
    // data, same principle as Patients/Appointments (§14).
    if (!queue || queue.hospitalId !== actor.hospitalId) {
      throw new AppException('QUEUE_NOT_FOUND', 'Queue not found.', HttpStatus.NOT_FOUND);
    }
    return queue;
  }

  private async getTenantScopedEntryOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<QueueEntry> {
    const entry = await this.prisma.queueEntry.findUnique({ where: { id } });
    if (!entry) {
      throw new AppException(
        'QUEUE_ENTRY_NOT_FOUND',
        'Queue entry not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const queue = await this.prisma.queue.findUniqueOrThrow({ where: { id: entry.queueId } });
    if (queue.hospitalId !== actor.hospitalId) {
      throw new AppException(
        'QUEUE_ENTRY_NOT_FOUND',
        'Queue entry not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return entry;
  }

  private toQueueResponse(queue: Queue): QueueResponseDto {
    return {
      id: queue.id,
      hospitalId: queue.hospitalId,
      departmentId: queue.departmentId,
      doctorProfileId: queue.doctorProfileId,
      queueDate: queue.queueDate,
      isActive: queue.isActive,
    };
  }

  private toEntryResponse(entry: QueueEntry): QueueEntryResponseDto {
    return {
      id: entry.id,
      queueId: entry.queueId,
      appointmentId: entry.appointmentId,
      patientId: entry.patientId,
      tokenNumber: entry.tokenNumber,
      status: entry.status,
      priority: entry.priority,
      joinedAt: entry.joinedAt,
      calledAt: entry.calledAt,
      completedAt: entry.completedAt,
      skippedAt: entry.skippedAt,
      cancelledAt: entry.cancelledAt,
    };
  }
}
