import { Gender, Role } from '@prisma/client';
import { PatientsService } from './patients.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('PatientsService', () => {
  let prisma: any;
  let auditService: any;
  let service: PatientsService;

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

  const validDto = {
    firstName: 'Asha',
    lastName: 'Patel',
    dateOfBirth: '1990-05-14',
    gender: Gender.FEMALE,
    phone: '+91 98765 43210',
  };

  beforeEach(() => {
    prisma = {
      patient: { findFirst: jest.fn(), findUnique: jest.fn() },
      hospital: { update: jest.fn() },
      $transaction: jest.fn(),
    };
    auditService = { log: jest.fn() };
    service = new PatientsService(prisma, auditService);
  });

  describe('create — duplicate prevention (§22)', () => {
    it('rejects registration when an active patient already matches phone + dateOfBirth', async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: 'existing', mrn: 'SUN-000004' });

      await expect(service.create(validDto, actor)).rejects.toMatchObject({
        code: 'POTENTIAL_DUPLICATE_PATIENT',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ignores inactive patients when checking for duplicates', async () => {
      // findFirst itself is called with isActive: true in its where clause,
      // so an inactive-only match naturally returns null from the mock here.
      prisma.patient.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          hospital: { update: jest.fn().mockResolvedValue({ code: 'SUN', mrnSequence: 5 }) },
          patient: {
            create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'p1', ...data })),
          },
        }),
      );

      await expect(service.create(validDto, actor)).resolves.toMatchObject({ firstName: 'Asha' });
      expect(prisma.patient.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
    });

    it('allows registration despite a duplicate match when confirmDuplicate is true', async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: 'existing', mrn: 'SUN-000004' });
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          hospital: { update: jest.fn().mockResolvedValue({ code: 'SUN', mrnSequence: 6 }) },
          patient: {
            create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'p2', ...data })),
          },
        }),
      );

      const result = await service.create({ ...validDto, confirmDuplicate: true }, actor);
      expect(result.firstName).toBe('Asha');
    });

    it('does not duplicate-check at all when confirmDuplicate is true (skips the lookup)', async () => {
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          hospital: { update: jest.fn().mockResolvedValue({ code: 'SUN', mrnSequence: 1 }) },
          patient: {
            create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'p3', ...data })),
          },
        }),
      );

      await service.create({ ...validDto, confirmDuplicate: true }, actor);
      expect(prisma.patient.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('tenant isolation', () => {
    it('returns 404-style NOT_FOUND for a patient in a different hospital, not 403', async () => {
      prisma.patient.findUnique.mockResolvedValue({ id: 'p-b', hospitalId: 'hospital-b' });

      await expect(service.findOneForTenant('p-b', actor)).rejects.toMatchObject({
        code: 'PATIENT_NOT_FOUND',
      });
    });

    it('does NOT grant SUPER_ADMIN a cross-tenant bypass (§14 — clinical data, fixed in Phase 2)', async () => {
      prisma.patient.findUnique.mockResolvedValue({ id: 'p-a', hospitalId: 'hospital-a' });

      await expect(service.findOneForTenant('p-a', superAdmin)).rejects.toMatchObject({
        code: 'PATIENT_NOT_FOUND',
      });
    });
  });

  describe('Phase 5: getOrCreateForConnectUser', () => {
    const connectUser = {
      id: 'connect-1',
      firstName: 'Riya',
      lastName: 'Shah',
      phone: '+91 90000 00001',
      dateOfBirth: new Date('1995-01-01'),
      gender: Gender.FEMALE,
      email: 'riya@example.com',
    };

    it('returns the existing Patient row for this (hospital, Connect user) pair without creating a new one', async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: 'existing-patient',
        hospitalId: 'hospital-a',
      });

      const result = await service.getOrCreateForConnectUser('hospital-a', connectUser);

      expect(result).toMatchObject({ id: 'existing-patient' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with PATIENT_PROFILE_INCOMPLETE when phone/DOB/gender are not all set', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.getOrCreateForConnectUser('hospital-a', { ...connectUser, phone: null }),
      ).rejects.toMatchObject({ code: 'PATIENT_PROFILE_INCOMPLETE' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('auto-creates a new Patient row (atomic MRN) on first contact with a hospital', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          hospital: { update: jest.fn().mockResolvedValue({ code: 'SUN', mrnSequence: 9 }) },
          patient: {
            create: jest
              .fn()
              .mockImplementation(({ data }: any) => ({ id: 'new-patient', ...data })),
          },
        }),
      );

      const result = await service.getOrCreateForConnectUser('hospital-a', connectUser);

      expect(result).toMatchObject({ id: 'new-patient', userId: 'connect-1', mrn: 'SUN-000009' });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PATIENT_RECORD_LINKED' }),
      );
    });

    it('scopes the "does this Connect user already have a record here" check to THIS hospital, not globally', async () => {
      // Regression test: Patient.userId was briefly a bare @unique column
      // (global, not per-hospital), which would have made this exact
      // lookup find nothing for hospital-b even though the user already
      // has a row at hospital-a — then crashed on create() with a unique
      // violation. Fixed to @@unique([hospitalId, userId]); this asserts
      // the application query itself was already filtering by both.
      prisma.patient.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          hospital: { update: jest.fn().mockResolvedValue({ code: 'MOON', mrnSequence: 1 }) },
          patient: {
            create: jest
              .fn()
              .mockImplementation(({ data }: any) => ({ id: 'new-patient-2', ...data })),
          },
        }),
      );

      await service.getOrCreateForConnectUser('hospital-b', connectUser);

      expect(prisma.patient.findFirst).toHaveBeenCalledWith({
        where: { hospitalId: 'hospital-b', userId: 'connect-1' },
      });
    });
  });

  describe('Phase 5: claimExistingRecord', () => {
    const claim = {
      hospitalId: 'hospital-a',
      mrn: 'SUN-000004',
      dateOfBirth: '1990-05-14',
      phone: '+91 98765 43210',
    };
    const existingRecord = {
      id: 'claimable-1',
      userId: null,
      dateOfBirth: new Date('1990-05-14'),
      phone: '+91 98765 43210',
    };

    it('links the record and returns it when MRN + DOB + phone all match an unclaimed record', async () => {
      prisma.patient.findUnique.mockResolvedValue(existingRecord);
      prisma.patient.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.patient.findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ ...existingRecord, userId: 'connect-1' });

      const result = await service.claimExistingRecord({ id: 'connect-1' }, claim);

      expect(prisma.patient.updateMany).toHaveBeenCalledWith({
        where: { id: existingRecord.id, userId: null },
        data: { userId: 'connect-1' },
      });
      expect(result).toMatchObject({ userId: 'connect-1' });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PATIENT_RECORD_LINKED' }),
      );
    });

    it('rejects with the SAME generic error when a concurrent claim wins the race (updateMany affects 0 rows)', async () => {
      prisma.patient.findUnique.mockResolvedValue(existingRecord);
      prisma.patient.updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await expect(service.claimExistingRecord({ id: 'connect-1' }, claim)).rejects.toMatchObject({
        code: 'PATIENT_RECORD_CLAIM_FAILED',
      });
    });

    it('rejects with one generic error when no record matches the MRN', async () => {
      prisma.patient.findUnique.mockResolvedValue(null);

      await expect(service.claimExistingRecord({ id: 'connect-1' }, claim)).rejects.toMatchObject({
        code: 'PATIENT_RECORD_CLAIM_FAILED',
      });
    });

    it('rejects with the SAME generic error when the record is already claimed by someone else', async () => {
      prisma.patient.findUnique.mockResolvedValue({ ...existingRecord, userId: 'someone-else' });

      await expect(service.claimExistingRecord({ id: 'connect-1' }, claim)).rejects.toMatchObject({
        code: 'PATIENT_RECORD_CLAIM_FAILED',
      });
    });

    it('rejects with the SAME generic error when phone does not match (never reveals which field was wrong)', async () => {
      prisma.patient.findUnique.mockResolvedValue(existingRecord);

      await expect(
        service.claimExistingRecord({ id: 'connect-1' }, { ...claim, phone: '+91 00000 00000' }),
      ).rejects.toMatchObject({ code: 'PATIENT_RECORD_CLAIM_FAILED' });
    });
  });

  describe('Phase 5: Connect ownership helpers', () => {
    it('listForConnectUser returns only records linked to that Connect account', async () => {
      prisma.patient.findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'p1', userId: 'connect-1', hospitalId: 'hospital-a' }]);

      const result = await service.listForConnectUser('connect-1');

      expect(prisma.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'connect-1' } }),
      );
      expect(result).toHaveLength(1);
    });

    it('getOwnPatientRecordOrThrow returns NOT_FOUND for a record linked to a different Connect user', async () => {
      prisma.patient.findUnique.mockResolvedValue({ id: 'p1', userId: 'someone-else' });

      await expect(service.getOwnPatientRecordOrThrow('p1', 'connect-1')).rejects.toMatchObject({
        code: 'PATIENT_NOT_FOUND',
      });
    });

    it('getOwnPatientRecordOrThrow returns the record when it belongs to the caller', async () => {
      prisma.patient.findUnique.mockResolvedValue({ id: 'p1', userId: 'connect-1' });

      await expect(service.getOwnPatientRecordOrThrow('p1', 'connect-1')).resolves.toMatchObject({
        id: 'p1',
      });
    });
  });
});
