import { Role } from '@prisma/client';
import { EncountersService } from './encounters.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('EncountersService', () => {
  let prisma: any;
  let auditService: any;
  let patientsService: any;
  let doctorsService: any;
  let appointmentsService: any;
  let service: EncountersService;

  const actor: AuthenticatedUser = {
    userId: 'user-doctor-1',
    email: 'doc@hospitalos.dev',
    role: Role.DOCTOR,
    hospitalId: 'hospital-a',
  };

  const doctor = {
    id: 'doctor-1',
    userId: 'user-doctor-1',
    hospitalId: 'hospital-a',
    departmentId: 'dept-1',
  };

  const inConsultationAppointment = {
    id: 'appt-1',
    hospitalId: 'hospital-a',
    patientId: 'patient-1',
    doctorProfileId: 'doctor-1',
    departmentId: 'dept-1',
    status: 'IN_CONSULTATION',
  };

  const activePatient = { id: 'patient-1', hospitalId: 'hospital-a', isActive: true };

  beforeEach(() => {
    prisma = {
      encounter: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn((args: any) => ({ id: 'encounter-1', ...args.data })),
        update: jest.fn((args: any) => ({ id: 'encounter-1', ...args.data })),
      },
      appointment: { update: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    patientsService = { getTenantScopedPatientOrThrow: jest.fn() };
    doctorsService = { getOwnDoctorProfileOrThrow: jest.fn().mockResolvedValue(doctor) };
    appointmentsService = { getTenantScopedAppointmentOrThrow: jest.fn() };
    service = new EncountersService(
      prisma,
      auditService,
      patientsService,
      doctorsService,
      appointmentsService,
    );
  });

  describe('create', () => {
    it('rejects a caller with no hospital context', async () => {
      await expect(service.create({}, { ...actor, hospitalId: null })).rejects.toMatchObject({
        code: 'TENANT_CONTEXT_MISSING',
      });
    });

    it('rejects starting an encounter from another doctor’s appointment', async () => {
      appointmentsService.getTenantScopedAppointmentOrThrow.mockResolvedValue({
        ...inConsultationAppointment,
        doctorProfileId: 'someone-else',
      });

      await expect(service.create({ appointmentId: 'appt-1' }, actor)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('rejects starting an encounter before the queue has moved the appointment to IN_CONSULTATION', async () => {
      appointmentsService.getTenantScopedAppointmentOrThrow.mockResolvedValue({
        ...inConsultationAppointment,
        status: 'IN_QUEUE',
      });

      await expect(service.create({ appointmentId: 'appt-1' }, actor)).rejects.toMatchObject({
        code: 'APPOINTMENT_NOT_IN_CONSULTATION',
      });
    });

    it('starts an encounter from an appointment the queue has already moved to IN_CONSULTATION', async () => {
      appointmentsService.getTenantScopedAppointmentOrThrow.mockResolvedValue(
        inConsultationAppointment,
      );

      const result = await service.create({ appointmentId: 'appt-1' }, actor);

      expect(prisma.appointment.update).not.toHaveBeenCalled();
      expect(result.patientId).toBe('patient-1');
      expect(result.departmentId).toBe('dept-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ENCOUNTER_CREATED' }),
      );
    });

    it('rejects a walk-in encounter with no patientId', async () => {
      await expect(service.create({}, actor)).rejects.toMatchObject({
        code: 'PATIENT_ID_REQUIRED',
      });
    });

    it('rejects a walk-in encounter for an inactive patient', async () => {
      patientsService.getTenantScopedPatientOrThrow.mockResolvedValue({
        ...activePatient,
        isActive: false,
      });

      await expect(service.create({ patientId: 'patient-1' }, actor)).rejects.toMatchObject({
        code: 'PATIENT_INACTIVE',
      });
    });

    it('starts a walk-in encounter under the doctor’s own department', async () => {
      patientsService.getTenantScopedPatientOrThrow.mockResolvedValue(activePatient);

      const result = await service.create({ patientId: 'patient-1' }, actor);

      expect(result.departmentId).toBe('dept-1');
      expect(result.appointmentId).toBeNull();
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    const inProgress = {
      id: 'encounter-1',
      hospitalId: 'hospital-a',
      doctorProfileId: 'doctor-1',
      appointmentId: 'appt-1',
      status: 'IN_PROGRESS',
    };

    it('rejects a doctor who does not own the encounter', async () => {
      prisma.encounter.findUnique.mockResolvedValue(inProgress);
      doctorsService.getOwnDoctorProfileOrThrow.mockResolvedValue({
        ...doctor,
        id: 'someone-else',
      });

      await expect(service.complete('encounter-1', actor)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('rejects completing an encounter that is not IN_PROGRESS', async () => {
      prisma.encounter.findUnique.mockResolvedValue({ ...inProgress, status: 'COMPLETED' });

      await expect(service.complete('encounter-1', actor)).rejects.toMatchObject({
        code: 'ENCOUNTER_NOT_IN_PROGRESS',
      });
    });

    it('completes the encounter and syncs the linked appointment', async () => {
      prisma.encounter.findUnique.mockResolvedValue(inProgress);

      const result = await service.complete('encounter-1', actor);

      expect(result.status).toBe('COMPLETED');
      expect(prisma.appointment.updateMany).toHaveBeenCalledWith({
        where: { id: 'appt-1', status: 'IN_CONSULTATION' },
        data: { status: 'COMPLETED' },
      });
    });
  });

  describe('cancel', () => {
    it('cancels an IN_PROGRESS encounter owned by the caller', async () => {
      prisma.encounter.findUnique.mockResolvedValue({
        id: 'encounter-1',
        hospitalId: 'hospital-a',
        doctorProfileId: 'doctor-1',
        status: 'IN_PROGRESS',
      });

      const result = await service.cancel('encounter-1', actor);
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('getTenantScopedEncounterOrThrow', () => {
    it('returns 404-style NOT_FOUND for a different-hospital encounter', async () => {
      prisma.encounter.findUnique.mockResolvedValue({
        id: 'encounter-1',
        hospitalId: 'hospital-b',
      });

      await expect(
        service.getTenantScopedEncounterOrThrow('encounter-1', actor),
      ).rejects.toMatchObject({ code: 'ENCOUNTER_NOT_FOUND' });
    });
  });
});
