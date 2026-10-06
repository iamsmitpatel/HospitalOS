import { Role } from '@prisma/client';
import { LabTestsService } from './lab-tests.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('LabTestsService', () => {
  let prisma: any;
  let auditService: any;
  let service: LabTestsService;

  const actor: AuthenticatedUser = {
    userId: 'admin-1',
    email: 'admin@hospitalos.dev',
    role: Role.HOSPITAL_ADMIN,
    hospitalId: 'hospital-a',
  };

  const labTest = {
    id: 'labtest-1',
    hospitalId: 'hospital-a',
    name: 'Complete Blood Count',
    code: 'CBC',
    category: null,
    sampleType: null,
    unit: null,
    referenceRangeLow: null,
    referenceRangeHigh: null,
    isActive: true,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      hospital: { findUnique: jest.fn().mockResolvedValue({ id: 'hospital-a', isActive: true }) },
      labTest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn((args: any) => ({ ...labTest, ...args.data })),
        update: jest.fn((args: any) => ({ ...labTest, ...args.data })),
      },
    };
    auditService = { log: jest.fn() };
    service = new LabTestsService(prisma, auditService);
  });

  describe('create', () => {
    it('rejects a duplicate code within the same hospital', async () => {
      prisma.labTest.findUnique.mockResolvedValue(labTest);

      await expect(
        service.create({ name: 'Complete Blood Count', code: 'CBC' }, actor),
      ).rejects.toMatchObject({ code: 'LAB_TEST_CODE_TAKEN' });
    });

    it('creates a catalog entry and audits it', async () => {
      prisma.labTest.findUnique.mockResolvedValue(null);

      const result = await service.create({ name: 'Complete Blood Count', code: 'CBC' }, actor);

      expect(result.code).toBe('CBC');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LABTEST_CREATED' }),
      );
    });
  });

  describe('update', () => {
    it('updates a catalog entry and audits it', async () => {
      prisma.labTest.findUnique.mockResolvedValue(labTest);

      const result = await service.update('labtest-1', { isActive: false }, actor);

      expect(result.isActive).toBe(false);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LABTEST_UPDATED' }),
      );
    });
  });

  describe('getTenantScopedLabTestOrThrow', () => {
    it('returns 404-style NOT_FOUND for a different-hospital lab test', async () => {
      prisma.labTest.findUnique.mockResolvedValue({ ...labTest, hospitalId: 'hospital-b' });

      await expect(service.getTenantScopedLabTestOrThrow('labtest-1', actor)).rejects.toMatchObject(
        { code: 'LAB_TEST_NOT_FOUND' },
      );
    });
  });
});
