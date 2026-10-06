import { Role } from '@prisma/client';
import { QueueService } from './queue.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('QueueService', () => {
  let prisma: any;
  let auditService: any;
  let appointmentsService: any;
  let notificationsService: any;
  let service: QueueService;

  const actor: AuthenticatedUser = {
    userId: 'staff-1',
    email: 'staff@hospitalos.dev',
    role: Role.RECEPTIONIST,
    hospitalId: 'hospital-a',
  };
  const superAdmin: AuthenticatedUser = {
    userId: 'super-1',
    email: 'super@hospitalos.dev',
    role: Role.SUPER_ADMIN,
    hospitalId: null,
  };

  const hospital = { id: 'hospital-a', timezone: 'Asia/Kolkata' };
  const scheduledAppointment = {
    id: 'appt-1',
    hospitalId: 'hospital-a',
    patientId: 'patient-1',
    doctorProfileId: 'doctor-1',
    departmentId: 'dept-1',
    status: 'SCHEDULED',
  };

  beforeEach(() => {
    prisma = {
      hospital: { findUniqueOrThrow: jest.fn().mockResolvedValue(hospital) },
      queue: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      queueEntry: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      appointment: { update: jest.fn() },
      patient: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: any) => cb(prisma)),
      $queryRaw: jest.fn(),
    };
    auditService = { log: jest.fn() };
    appointmentsService = { getTenantScopedAppointmentOrThrow: jest.fn() };
    notificationsService = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new QueueService(prisma, auditService, appointmentsService, notificationsService);
  });

  describe('checkIn', () => {
    it('rejects a SUPER_ADMIN caller (no clinical access, §14)', async () => {
      await expect(service.checkIn({ appointmentId: 'appt-1' }, superAdmin)).rejects.toMatchObject({
        code: 'TENANT_CONTEXT_MISSING',
      });
    });

    it('rejects an appointment that is not in a check-in-eligible state', async () => {
      appointmentsService.getTenantScopedAppointmentOrThrow.mockResolvedValue({
        ...scheduledAppointment,
        status: 'COMPLETED',
      });

      await expect(service.checkIn({ appointmentId: 'appt-1' }, actor)).rejects.toMatchObject({
        code: 'INVALID_APPOINTMENT_TRANSITION',
      });
    });

    it('rejects an appointment that already has a queue entry', async () => {
      appointmentsService.getTenantScopedAppointmentOrThrow.mockResolvedValue(scheduledAppointment);
      prisma.queueEntry.findUnique.mockResolvedValue({ id: 'existing-entry' });

      await expect(service.checkIn({ appointmentId: 'appt-1' }, actor)).rejects.toMatchObject({
        code: 'APPOINTMENT_ALREADY_IN_QUEUE',
      });
    });

    it('creates a queue entry, assigns a token, and moves the appointment to IN_QUEUE', async () => {
      appointmentsService.getTenantScopedAppointmentOrThrow.mockResolvedValue(scheduledAppointment);
      prisma.queueEntry.findUnique.mockResolvedValue(null);
      prisma.queue.upsert.mockResolvedValue({ id: 'queue-1', nextTokenNumber: 1 });
      prisma.queue.update.mockResolvedValue({ id: 'queue-1', nextTokenNumber: 2 });
      prisma.queueEntry.create.mockImplementation(({ data }: any) => ({
        ...data,
        status: 'WAITING',
        priority: 0,
        joinedAt: new Date(),
        calledAt: null,
        completedAt: null,
        skippedAt: null,
        cancelledAt: null,
      }));

      const result = await service.checkIn({ appointmentId: 'appt-1' }, actor);

      expect(result.tokenNumber).toBe(1);
      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'appt-1' },
        data: { status: 'IN_QUEUE' },
      });
    });
  });

  describe('callNext', () => {
    it('claims the next WAITING entry atomically via the raw SQL query', async () => {
      prisma.queue.findUnique.mockResolvedValue({ id: 'queue-1', hospitalId: 'hospital-a' });
      prisma.$queryRaw.mockResolvedValue([{ id: 'entry-1' }]);
      prisma.queueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'entry-1',
        queueId: 'queue-1',
        appointmentId: 'appt-1',
        patientId: 'patient-1',
        tokenNumber: 1,
        status: 'CALLED',
        priority: 0,
        joinedAt: new Date(),
        calledAt: new Date(),
        completedAt: null,
        skippedAt: null,
        cancelledAt: null,
      });

      const result = await service.callNext('queue-1', actor);

      expect(result.status).toBe('CALLED');
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(notificationsService.notify).not.toHaveBeenCalled();
    });

    it('notifies the patient when their record is linked to a Connect account', async () => {
      prisma.queue.findUnique.mockResolvedValue({ id: 'queue-1', hospitalId: 'hospital-a' });
      prisma.$queryRaw.mockResolvedValue([{ id: 'entry-1' }]);
      prisma.queueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'entry-1',
        queueId: 'queue-1',
        appointmentId: 'appt-1',
        patientId: 'patient-1',
        tokenNumber: 7,
        status: 'CALLED',
        priority: 0,
        joinedAt: new Date(),
        calledAt: new Date(),
      });
      prisma.patient.findUnique.mockResolvedValue({
        id: 'patient-1',
        user: { id: 'connect-1', email: 'patient@example.com' },
      });

      await service.callNext('queue-1', actor);

      expect(notificationsService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'QUEUE_CALLED',
          to: 'patient@example.com',
          recipientUserId: 'connect-1',
        }),
      );
    });

    it('throws a controlled NO_WAITING_PATIENTS when nothing is claimable', async () => {
      prisma.queue.findUnique.mockResolvedValue({ id: 'queue-1', hospitalId: 'hospital-a' });
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.callNext('queue-1', actor)).rejects.toMatchObject({
        code: 'NO_WAITING_PATIENTS',
      });
    });

    it('returns 404-style NOT_FOUND for a queue in a different hospital', async () => {
      prisma.queue.findUnique.mockResolvedValue({ id: 'queue-1', hospitalId: 'hospital-b' });

      await expect(service.callNext('queue-1', actor)).rejects.toMatchObject({
        code: 'QUEUE_NOT_FOUND',
      });
    });
  });

  describe('state machine actions', () => {
    const entryIn = (status: string, overrides: Record<string, unknown> = {}) => ({
      id: 'entry-1',
      queueId: 'queue-1',
      appointmentId: 'appt-1',
      patientId: 'patient-1',
      tokenNumber: 1,
      status,
      priority: 0,
      joinedAt: new Date(),
      calledAt: null,
      completedAt: null,
      skippedAt: null,
      cancelledAt: null,
      ...overrides,
    });

    beforeEach(() => {
      prisma.queue.findUniqueOrThrow.mockResolvedValue({ id: 'queue-1', hospitalId: 'hospital-a' });
    });

    it('allows WAITING -> SKIPPED', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(entryIn('WAITING'));
      prisma.queueEntry.update.mockResolvedValue(entryIn('SKIPPED'));

      const result = await service.skip('entry-1', actor);
      expect(result.status).toBe('SKIPPED');
    });

    it('rejects COMPLETED -> SKIPPED', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(entryIn('COMPLETED'));

      await expect(service.skip('entry-1', actor)).rejects.toMatchObject({
        code: 'INVALID_QUEUE_TRANSITION',
      });
    });

    it('allows SKIPPED -> WAITING via requeue with a fresh token', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(entryIn('SKIPPED'));
      prisma.queue.update.mockResolvedValue({ id: 'queue-1', nextTokenNumber: 6 });
      prisma.queueEntry.update.mockResolvedValue(entryIn('WAITING', { tokenNumber: 5 }));

      const result = await service.requeue('entry-1', actor);
      expect(result.status).toBe('WAITING');
      expect(result.tokenNumber).toBe(5);
    });

    it('rejects WAITING -> WAITING via requeue (not currently SKIPPED)', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(entryIn('WAITING'));

      await expect(service.requeue('entry-1', actor)).rejects.toMatchObject({
        code: 'INVALID_QUEUE_TRANSITION',
      });
    });

    it('moves CALLED -> IN_CONSULTATION and syncs the linked appointment', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(entryIn('CALLED'));
      prisma.queueEntry.update.mockResolvedValue(entryIn('IN_CONSULTATION'));

      await service.startConsultation('entry-1', actor);

      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'appt-1' },
        data: { status: 'IN_CONSULTATION' },
      });
    });

    it('completes IN_CONSULTATION and syncs the linked appointment + audits both', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(entryIn('IN_CONSULTATION'));
      prisma.queueEntry.update.mockResolvedValue(entryIn('COMPLETED'));

      await service.complete('entry-1', actor);

      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'appt-1' },
        data: { status: 'COMPLETED' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'QUEUE_ENTRY_COMPLETED' }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPOINTMENT_COMPLETED' }),
      );
    });

    it('cancels a WAITING entry and cancels the linked appointment', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(entryIn('WAITING'));
      prisma.queueEntry.update.mockResolvedValue(entryIn('CANCELLED'));

      await service.cancel('entry-1', actor);

      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-1' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });

    it('returns 404-style NOT_FOUND for an entry belonging to a different-hospital queue', async () => {
      prisma.queueEntry.findUnique.mockResolvedValue(entryIn('WAITING'));
      prisma.queue.findUniqueOrThrow.mockResolvedValue({ id: 'queue-1', hospitalId: 'hospital-b' });

      await expect(service.skip('entry-1', actor)).rejects.toMatchObject({
        code: 'QUEUE_ENTRY_NOT_FOUND',
      });
    });
  });
});
