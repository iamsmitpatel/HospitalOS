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
});
