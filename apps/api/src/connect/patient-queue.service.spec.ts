import { PatientQueueService } from './patient-queue.service';

describe('PatientQueueService', () => {
  let prisma: any;
  let service: PatientQueueService;

  const waitingEntry = {
    id: 'qe-1',
    queueId: 'queue-1',
    appointmentId: 'appt-1',
    patientId: 'patient-connect-1',
    tokenNumber: 4,
    status: 'WAITING',
    priority: 0,
    joinedAt: new Date('2026-10-06T03:00:00.000Z'),
    calledAt: null,
    queue: { hospitalId: 'hospital-a' },
  };

  beforeEach(() => {
    prisma = {
      queueEntry: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      patient: { findUnique: jest.fn() },
    };
    service = new PatientQueueService(prisma);
  });

  describe('getStatusForAppointment', () => {
    it('returns QUEUE_ENTRY_NOT_FOUND when no queue entry exists for the appointment', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(null);

      await expect(service.getStatusForAppointment('appt-1', 'connect-1')).rejects.toMatchObject({
        code: 'QUEUE_ENTRY_NOT_FOUND',
      });
    });

    it('returns the SAME generic error when the entry belongs to a different Connect user (never leaks that it exists)', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(waitingEntry);
      prisma.patient.findUnique.mockResolvedValue({
        id: 'patient-connect-1',
        userId: 'someone-else',
      });

      await expect(service.getStatusForAppointment('appt-1', 'connect-1')).rejects.toMatchObject({
        code: 'QUEUE_ENTRY_NOT_FOUND',
      });
    });

    it('computes position as count of WAITING entries ahead, plus one', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(waitingEntry);
      prisma.patient.findUnique.mockResolvedValue({ id: 'patient-connect-1', userId: 'connect-1' });
      prisma.queueEntry.count.mockResolvedValue(3);

      const result = await service.getStatusForAppointment('appt-1', 'connect-1');

      expect(prisma.queueEntry.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ queueId: 'queue-1', status: 'WAITING' }),
        }),
      );
      expect(result.position).toBe(4);
      expect(result.tokenNumber).toBe(4);
      expect(result.hospitalId).toBe('hospital-a');
    });

    it('returns a null position for a CALLED entry (no longer waiting in line)', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue({
        ...waitingEntry,
        status: 'CALLED',
        calledAt: new Date(),
      });
      prisma.patient.findUnique.mockResolvedValue({ id: 'patient-connect-1', userId: 'connect-1' });

      const result = await service.getStatusForAppointment('appt-1', 'connect-1');

      expect(result.position).toBeNull();
      expect(prisma.queueEntry.count).not.toHaveBeenCalled();
    });
  });

  describe('listMyActiveEntries', () => {
    it('scopes the query to this Connect user and only WAITING/CALLED statuses', async () => {
      prisma.queueEntry.findMany.mockResolvedValue([waitingEntry]);
      prisma.queueEntry.count.mockResolvedValue(0);

      const result = await service.listMyActiveEntries('connect-1');

      expect(prisma.queueEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patient: { userId: 'connect-1' }, status: { in: ['WAITING', 'CALLED'] } },
          include: { queue: { select: { hospitalId: true } } },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });
});
