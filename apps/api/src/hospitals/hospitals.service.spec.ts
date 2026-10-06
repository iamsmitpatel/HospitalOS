import { Role } from '@prisma/client';
import { HospitalsService } from './hospitals.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('HospitalsService', () => {
  let prisma: any;
  let auditService: any;
  let service: HospitalsService;

  const hospitalAdmin: AuthenticatedUser = {
    userId: 'admin-a',
    email: 'admin@hospitalos.dev',
    role: Role.HOSPITAL_ADMIN,
    hospitalId: 'hospital-a',
  };

  const hospital = {
    id: 'hospital-a',
    name: 'Sunrise',
    slug: 'sunrise',
    code: 'SUN',
    isActive: true,
    isPublic: false,
    publicDescription: null,
    addressLine: null,
    city: null,
    publicPhone: null,
    publicEmail: null,
    operatingHours: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      hospital: { findUnique: jest.fn(), update: jest.fn() },
    };
    auditService = { log: jest.fn() };
    service = new HospitalsService(prisma, auditService);
  });

  describe('updatePublicProfile', () => {
    it('rejects a different hospital’s admin (404, not 403)', async () => {
      prisma.hospital.findUnique.mockResolvedValue({ ...hospital, id: 'hospital-b' });

      await expect(
        service.updatePublicProfile('hospital-b', { isPublic: true }, hospitalAdmin),
      ).rejects.toMatchObject({ code: 'HOSPITAL_NOT_FOUND' });
    });

    it('lets a HOSPITAL_ADMIN opt their own hospital into discovery and audits it', async () => {
      prisma.hospital.findUnique.mockResolvedValue(hospital);
      prisma.hospital.update.mockImplementation(({ data }: any) => ({ ...hospital, ...data }));

      const result = await service.updatePublicProfile(
        'hospital-a',
        { isPublic: true, city: 'Mumbai', operatingHours: 'Mon-Sat 9:00-18:00' },
        hospitalAdmin,
      );

      expect(result.isPublic).toBe(true);
      expect(result.city).toBe('Mumbai');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'HOSPITAL_PUBLIC_PROFILE_UPDATED' }),
      );
    });
  });
});
