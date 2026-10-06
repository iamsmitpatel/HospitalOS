import { Role } from '@prisma/client';
import { DepartmentsService } from './departments.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('DepartmentsService', () => {
  let prisma: any;
  let auditService: any;
  let service: DepartmentsService;

  const superAdmin: AuthenticatedUser = {
    userId: 'super-1',
    email: 'super@hospitalos.dev',
    role: Role.SUPER_ADMIN,
    hospitalId: null,
  };
  const hospitalAdminA: AuthenticatedUser = {
    userId: 'admin-a',
    email: 'admin-a@hospitalos.dev',
    role: Role.HOSPITAL_ADMIN,
    hospitalId: 'hospital-a',
  };

  beforeEach(() => {
    prisma = {
      department: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      hospital: { findUnique: jest.fn() },
    };
    auditService = { log: jest.fn() };
    service = new DepartmentsService(prisma, auditService);
  });

  describe('create — tenant derivation', () => {
    it('derives hospitalId from a HOSPITAL_ADMIN actor, ignoring any client-supplied value', async () => {
      prisma.department.findFirst.mockResolvedValue(null);
      prisma.department.create.mockImplementation(({ data }: any) => ({ id: 'dep-1', ...data }));

      const result = await service.create(
        { name: 'Cardiology', code: 'CARD', hospitalId: 'hospital-b' },
        hospitalAdminA,
      );

      expect(result.hospitalId).toBe('hospital-a');
    });

    it('requires an explicit, existing, active hospitalId for a SUPER_ADMIN', async () => {
      await expect(
        service.create({ name: 'Cardiology', code: 'CARD' }, superAdmin),
      ).rejects.toMatchObject({ code: 'HOSPITAL_ID_REQUIRED' });

      prisma.hospital.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ name: 'Cardiology', code: 'CARD', hospitalId: 'missing' }, superAdmin),
      ).rejects.toMatchObject({ code: 'HOSPITAL_NOT_FOUND' });
    });

    it('rejects a duplicate code or name within the same hospital as a conflict', async () => {
      prisma.department.findFirst.mockResolvedValue({
        id: 'existing',
        code: 'CARD',
        name: 'Cardiology',
      });

      await expect(
        service.create({ name: 'Cardiology', code: 'CARD' }, hospitalAdminA),
      ).rejects.toMatchObject({ code: 'DEPARTMENT_IDENTIFIER_TAKEN' });
    });
  });

  describe('getTenantScopedDepartmentOrThrow (via findOneForTenant)', () => {
    it('returns 404-style NOT_FOUND for a department in a different hospital, not 403', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'd-b', hospitalId: 'hospital-b' });

      await expect(service.findOneForTenant('d-b', hospitalAdminA)).rejects.toMatchObject({
        code: 'DEPARTMENT_NOT_FOUND',
      });
    });

    it('allows a SUPER_ADMIN to fetch a department from any hospital', async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: 'd-b',
        hospitalId: 'hospital-b',
        name: 'Cardiology',
        code: 'CARD',
        description: null,
        isActive: true,
        createdAt: new Date(),
      });

      const result = await service.findOneForTenant('d-b', superAdmin);
      expect(result.id).toBe('d-b');
    });
  });
});
