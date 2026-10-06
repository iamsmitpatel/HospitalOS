import { HttpStatus, Injectable } from '@nestjs/common';
import { QueueEntry, QueueEntryStatus } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { PatientQueueStatusResponseDto } from './dto/patient-queue-status-response.dto';

const ACTIVE_STATUSES: QueueEntryStatus[] = ['WAITING', 'CALLED'];

/**
 * Read-only, patient-facing queue status. Deliberately NOT added to
 * queue.service.ts: that service is staff-actor-centric (tenant-scoped,
 * mutating). This is a separate query surface so the privacy rule (own
 * entry + an aggregate count only, never another patient's identity) can't
 * accidentally be weakened by a future staff-side change.
 */
@Injectable()
export class PatientQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async listMyActiveEntries(connectUserId: string): Promise<PatientQueueStatusResponseDto[]> {
    const entries = await this.prisma.queueEntry.findMany({
      where: {
        patient: { userId: connectUserId },
        status: { in: ACTIVE_STATUSES },
      },
      include: { queue: { select: { hospitalId: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return Promise.all(entries.map((entry) => this.toResponse(entry)));
  }

  async getStatusForAppointment(
    appointmentId: string,
    connectUserId: string,
  ): Promise<PatientQueueStatusResponseDto> {
    const entry = await this.prisma.queueEntry.findUnique({
      where: { appointmentId },
      include: { queue: { select: { hospitalId: true } } },
    });
    if (!entry) {
      throw new AppException(
        'QUEUE_ENTRY_NOT_FOUND',
        'Queue entry not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const patient = await this.prisma.patient.findUnique({ where: { id: entry.patientId } });
    if (!patient || patient.userId !== connectUserId) {
      throw new AppException(
        'QUEUE_ENTRY_NOT_FOUND',
        'Queue entry not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.toResponse(entry);
  }

  // Reads hospitalId off an already-joined `queue` relation rather than
  // querying for it separately — listMyActiveEntries would otherwise issue
  // one extra query per entry (classic N+1); both call sites above
  // `include` it for exactly this reason.
  private async toResponse(
    entry: QueueEntry & { queue: { hospitalId: string } },
  ): Promise<PatientQueueStatusResponseDto> {
    let position: number | null = null;
    if (entry.status === 'WAITING') {
      const ahead = await this.prisma.queueEntry.count({
        where: {
          queueId: entry.queueId,
          status: 'WAITING',
          OR: [
            { priority: { gt: entry.priority } },
            { priority: entry.priority, joinedAt: { lt: entry.joinedAt } },
          ],
        },
      });
      position = ahead + 1;
    }

    return {
      queueEntryId: entry.id,
      appointmentId: entry.appointmentId!,
      hospitalId: entry.queue.hospitalId,
      status: entry.status,
      tokenNumber: entry.tokenNumber,
      position,
      joinedAt: entry.joinedAt,
      calledAt: entry.calledAt,
    };
  }
}
