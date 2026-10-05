import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('UsersService', () => {
  let prisma: any;
  let configService: any;
  let auditService: any;
  let service: UsersService;

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
      user: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      hospital: { findUnique: jest.fn() },
    };
    configService = { get: jest.fn().mockReturnValue(4) };
    auditService = { log: jest.fn() };
    service = new UsersService(prisma, configService, auditService);
  });

  describe('create — tenant derivation', () => {
    it('forces hospitalId to the caller tenant when a HOSPITAL_ADMIN creates a user, ignoring the client value', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: any) => ({ id: 'new-user', ...data }));

      const result = await service.create(
        {
          email: 'doc@example.com',
          password: 'Str0ngPass1',
          firstName: 'Doc',
          lastName: 'Tor',
          role: Role.DOCTOR,
          hospitalId: 'hospital-b', // attempted cross-tenant plant
        },
        hospitalAdminA,
      );

      expect(result.hospitalId).toBe('hospital-a');
    });

    it('forbids a HOSPITAL_ADMIN from creating another HOSPITAL_ADMIN', async () => {
      await expect(
        service.create(
          {
            email: 'x@example.com',
            password: 'Str0ngPass1',
            firstName: 'X',
            lastName: 'Y',
            role: Role.HOSPITAL_ADMIN,
          },
          hospitalAdminA,
        ),
      ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
    });

    it('requires an explicit, existing hospitalId when a SUPER_ADMIN creates a non-SUPER_ADMIN user', async () => {
      await expect(
        service.create(
          {
            email: 'x@example.com',
            password: 'Str0ngPass1',
            firstName: 'X',
            lastName: 'Y',
            role: Role.NURSE,
          },
          superAdmin,
        ),
      ).rejects.toMatchObject({ code: 'HOSPITAL_ID_REQUIRED' });

      prisma.hospital.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          {
            email: 'x@example.com',
            password: 'Str0ngPass1',
            firstName: 'X',
            lastName: 'Y',
            role: Role.NURSE,
            hospitalId: 'missing-hospital',
          },
          superAdmin,
        ),
      ).rejects.toMatchObject({ code: 'HOSPITAL_NOT_FOUND' });
    });

    it('rejects a duplicate email with a 409-style conflict', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(
          {
            email: 'dup@example.com',
            password: 'Str0ngPass1',
            firstName: 'X',
            lastName: 'Y',
            role: Role.DOCTOR,
          },
          hospitalAdminA,
        ),
      ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_IN_USE' });
    });
  });

  describe('getTenantScopedUserOrThrow (via findOneForTenant)', () => {
    it('returns 404-style NOT_FOUND for a user in a different hospital, not 403', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-b', hospitalId: 'hospital-b' });

      await expect(service.findOneForTenant('u-b', hospitalAdminA)).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });

    it('allows a SUPER_ADMIN to fetch a user from any hospital', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-b',
        hospitalId: 'hospital-b',
        email: 'u@b.com',
        firstName: 'A',
        lastName: 'B',
        role: Role.DOCTOR,
        isActive: true,
        createdAt: new Date(),
      });

      const result = await service.findOneForTenant('u-b', superAdmin);
      expect(result.id).toBe('u-b');
    });
  });
});
