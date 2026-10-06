import { Prisma, Role } from '@prisma/client';
import { AppointmentsService, assertTransitionAllowed } from './appointments.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/exceptions/app.exception';

function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.3',
  });
}

describe('assertTransitionAllowed (state machine)', () => {
  it('allows the documented happy path', () => {
    expect(() => assertTransitionAllowed('SCHEDULED', 'CONFIRMED')).not.toThrow();
    expect(() => assertTransitionAllowed('SCHEDULED', 'IN_QUEUE')).not.toThrow();
    expect(() => assertTransitionAllowed('IN_QUEUE', 'IN_CONSULTATION')).not.toThrow();
    expect(() => assertTransitionAllowed('IN_CONSULTATION', 'COMPLETED')).not.toThrow();
  });

  it('rejects COMPLETED -> SCHEDULED (master doc §32 explicit example)', () => {
    expect(() => assertTransitionAllowed('COMPLETED', 'SCHEDULED')).toThrow(AppException);
  });

  it('rejects any transition out of a terminal state', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      for (const target of [
        'SCHEDULED',
        'CONFIRMED',
        'IN_QUEUE',
        'IN_CONSULTATION',
        'COMPLETED',
      ] as const) {
        expect(() => assertTransitionAllowed(terminal, target)).toThrow(AppException);
      }
    }
  });

  it('rejects skipping straight from SCHEDULED to IN_CONSULTATION', () => {
    expect(() => assertTransitionAllowed('SCHEDULED', 'IN_CONSULTATION')).toThrow(AppException);
  });
});

describe('AppointmentsService', () => {
  let prisma: any;
  let auditService: any;
  let patientsService: any;
  let doctorsService: any;
  let service: AppointmentsService;

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

  const activePatient = { id: 'patient-1', hospitalId: 'hospital-a', isActive: true };
  const activeDoctor = {
    id: 'doctor-1',
    hospitalId: 'hospital-a',
    departmentId: 'dept-1',
    status: 'ACTIVE',
  };
  const hospital = { id: 'hospital-a', timezone: 'Asia/Kolkata' };

  const FUTURE_SLOT_ISO = '2027-10-11T03:30:00.000Z'; // 09:00 IST, a Monday

  beforeEach(() => {
    prisma = {
      hospital: { findUniqueOrThrow: jest.fn().mockResolvedValue(hospital) },
      appointment: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      queueEntry: { updateMany: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    patientsService = { getTenantScopedPatientOrThrow: jest.fn().mockResolvedValue(activePatient) };
    doctorsService = {
      getTenantScopedDoctorOrThrow: jest.fn().mockResolvedValue(activeDoctor),
      getAvailableSlots: jest.fn().mockResolvedValue([FUTURE_SLOT_ISO]),
    };
    service = new AppointmentsService(prisma, auditService, patientsService, doctorsService);
  });

  describe('create', () => {
    const validDto = {
      patientId: 'patient-1',
      doctorProfileId: 'doctor-1',
      scheduledAt: FUTURE_SLOT_ISO,
    };

    it('rejects a SUPER_ADMIN caller (no clinical access, §14)', async () => {
      await expect(service.create(validDto, superAdmin)).rejects.toMatchObject({
        code: 'TENANT_CONTEXT_MISSING',
      });
    });

    it('rejects an inactive patient', async () => {
      patientsService.getTenantScopedPatientOrThrow.mockResolvedValue({
        ...activePatient,
        isActive: false,
      });
      await expect(service.create(validDto, actor)).rejects.toMatchObject({
        code: 'PATIENT_INACTIVE',
      });
    });

    it('rejects an inactive doctor', async () => {
      doctorsService.getTenantScopedDoctorOrThrow.mockResolvedValue({
        ...activeDoctor,
        status: 'INACTIVE',
      });
      await expect(service.create(validDto, actor)).rejects.toMatchObject({
        code: 'DOCTOR_INACTIVE',
      });
    });

    it('rejects a scheduledAt in the past', async () => {
      await expect(
        service.create({ ...validDto, scheduledAt: '2020-01-01T00:00:00.000Z' }, actor),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_IN_PAST' });
    });

    it('rejects a time that is not in the computed available-slots list', async () => {
      doctorsService.getAvailableSlots.mockResolvedValue([]);
      await expect(service.create(validDto, actor)).rejects.toMatchObject({
        code: 'SLOT_NOT_AVAILABLE',
      });
    });

    it('creates the appointment when every check passes', async () => {
      prisma.appointment.create.mockResolvedValue({
        id: 'appt-1',
        hospitalId: 'hospital-a',
        patientId: 'patient-1',
        doctorProfileId: 'doctor-1',
        departmentId: 'dept-1',
        scheduledAt: new Date(FUTURE_SLOT_ISO),
        durationMinutes: 15,
        status: 'SCHEDULED',
        reason: null,
        cancelledAt: null,
        cancellationReason: null,
        rescheduledFromId: null,
        bookedByUserId: 'staff-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create(validDto, actor);
      expect(result.status).toBe('SCHEDULED');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPOINTMENT_CREATED' }),
      );
    });

    it('converts a race-lost P2002 into a clean SLOT_ALREADY_BOOKED conflict', async () => {
      prisma.appointment.create.mockRejectedValue(makeP2002());
      await expect(service.create(validDto, actor)).rejects.toMatchObject({
        code: 'SLOT_ALREADY_BOOKED',
      });
    });
  });

  describe('cancel', () => {
    it('cancels a SCHEDULED appointment and its linked queue entry', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'appt-1',
        hospitalId: 'hospital-a',
        status: 'SCHEDULED',
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'appt-1',
        hospitalId: 'hospital-a',
        status: 'CANCELLED',
        scheduledAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.cancel('appt-1', {}, actor);

      expect(prisma.queueEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { appointmentId: 'appt-1', status: { in: ['WAITING', 'CALLED'] } },
        }),
      );
    });

    it('rejects cancelling an already-COMPLETED appointment', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'appt-1',
        hospitalId: 'hospital-a',
        status: 'COMPLETED',
      });

      await expect(service.cancel('appt-1', {}, actor)).rejects.toMatchObject({
        code: 'INVALID_APPOINTMENT_TRANSITION',
      });
    });

    it('returns 404-style NOT_FOUND for an appointment in a different hospital', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'appt-1',
        hospitalId: 'hospital-b',
        status: 'SCHEDULED',
      });

      await expect(service.cancel('appt-1', {}, actor)).rejects.toMatchObject({
        code: 'APPOINTMENT_NOT_FOUND',
      });
    });
  });

  describe('reschedule', () => {
    const original = {
      id: 'appt-1',
      hospitalId: 'hospital-a',
      patientId: 'patient-1',
      doctorProfileId: 'doctor-1',
      departmentId: 'dept-1',
      scheduledAt: new Date('2027-10-11T03:30:00.000Z'),
      durationMinutes: 15,
      status: 'SCHEDULED',
      reason: null,
    };
    const NEW_SLOT_ISO = '2027-10-11T03:45:00.000Z';

    it('rejects rescheduling an appointment that is already IN_QUEUE', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ ...original, status: 'IN_QUEUE' });

      await expect(
        service.reschedule('appt-1', { scheduledAt: NEW_SLOT_ISO }, actor),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_RESCHEDULABLE' });
    });

    it('cancels the original and creates a new appointment pointing back at it', async () => {
      prisma.appointment.findUnique.mockResolvedValue(original);
      doctorsService.getAvailableSlots.mockResolvedValue([NEW_SLOT_ISO]);
      prisma.appointment.create.mockImplementation(({ data }: any) => ({
        id: 'appt-2',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.reschedule('appt-1', { scheduledAt: NEW_SLOT_ISO }, actor);

      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-1' },
          data: expect.objectContaining({ status: 'CANCELLED', cancellationReason: 'RESCHEDULED' }),
        }),
      );
      expect(result.rescheduledFromId).toBe('appt-1');
    });
  });

  describe('markNoShow', () => {
    it('rejects a future appointment', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'appt-1',
        hospitalId: 'hospital-a',
        status: 'SCHEDULED',
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await expect(service.markNoShow('appt-1', actor)).rejects.toMatchObject({
        code: 'APPOINTMENT_NOT_YET_DUE',
      });
    });

    it('marks a past SCHEDULED appointment as NO_SHOW', async () => {
      prisma.appointment.findUnique.mockResolvedValue({
        id: 'appt-1',
        hospitalId: 'hospital-a',
        status: 'SCHEDULED',
        scheduledAt: new Date(Date.now() - 1000 * 60 * 60),
      });
      prisma.appointment.update.mockResolvedValue({
        id: 'appt-1',
        hospitalId: 'hospital-a',
        status: 'NO_SHOW',
        scheduledAt: new Date(Date.now() - 1000 * 60 * 60),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.markNoShow('appt-1', actor);
      expect(result.status).toBe('NO_SHOW');
    });
  });
});
