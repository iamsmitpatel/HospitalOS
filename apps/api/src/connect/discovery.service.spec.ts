import { DiscoveryService } from './discovery.service';

describe('DiscoveryService', () => {
  let prisma: any;
  let doctorsService: any;
  let service: DiscoveryService;

  const publicHospital = {
    id: 'hospital-a',
    name: 'Sunrise',
    slug: 'sunrise',
    isPublic: true,
    isActive: true,
    publicDescription: 'A great hospital',
    addressLine: '1 Main St',
    city: 'Mumbai',
    publicPhone: '+91 90000 00000',
    publicEmail: 'info@sunrise.dev',
    operatingHours: 'Mon-Sat 9:00-18:00',
  };

  beforeEach(() => {
    prisma = {
      hospital: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      department: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      doctorProfile: { findMany: jest.fn() },
    };
    doctorsService = {
      getPubliclyVisibleDoctorOrThrow: jest.fn(),
      getPublicAvailableSlots: jest.fn(),
    };
    service = new DiscoveryService(prisma, doctorsService);
  });

  describe('getHospital', () => {
    it('returns 404-style NOT_FOUND for a non-public hospital, never revealing it exists', async () => {
      prisma.hospital.findUnique.mockResolvedValue({ ...publicHospital, isPublic: false });

      await expect(service.getHospital('hospital-a')).rejects.toMatchObject({
        code: 'HOSPITAL_NOT_FOUND',
      });
    });

    it('returns 404 for an inactive hospital even if isPublic is true', async () => {
      prisma.hospital.findUnique.mockResolvedValue({ ...publicHospital, isActive: false });

      await expect(service.getHospital('hospital-a')).rejects.toMatchObject({
        code: 'HOSPITAL_NOT_FOUND',
      });
    });

    it('returns only the public field set for a public, active hospital', async () => {
      prisma.hospital.findUnique.mockResolvedValue(publicHospital);

      const result = await service.getHospital('hospital-a');

      expect(result).toEqual({
        id: 'hospital-a',
        name: 'Sunrise',
        slug: 'sunrise',
        publicDescription: 'A great hospital',
        addressLine: '1 Main St',
        city: 'Mumbai',
        publicPhone: '+91 90000 00000',
        publicEmail: 'info@sunrise.dev',
        operatingHours: 'Mon-Sat 9:00-18:00',
      });
      // Never leaks internal fields even if present on the row.
      expect((result as any).mrnSequence).toBeUndefined();
      expect((result as any).invoiceSequence).toBeUndefined();
      expect((result as any).code).toBeUndefined();
    });
  });

  describe('listHospitals', () => {
    it('always filters to isPublic+isActive regardless of query', async () => {
      prisma.hospital.findMany.mockResolvedValue([]);
      prisma.hospital.count.mockResolvedValue(0);

      await service.listHospitals({ page: 1, pageSize: 20 });

      expect(prisma.hospital.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isPublic: true, isActive: true }),
        }),
      );
    });
  });

  describe('listDoctors', () => {
    it('rejects listing doctors for a non-public hospital', async () => {
      prisma.hospital.findUnique.mockResolvedValue({ ...publicHospital, isPublic: false });

      await expect(service.listDoctors('hospital-a', {})).rejects.toMatchObject({
        code: 'HOSPITAL_NOT_FOUND',
      });
    });

    it('only queries ACTIVE, publicly-visible doctors for that hospital', async () => {
      prisma.hospital.findUnique.mockResolvedValue(publicHospital);
      prisma.doctorProfile.findMany.mockResolvedValue([]);

      await service.listDoctors('hospital-a', {});

      expect(prisma.doctorProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            hospitalId: 'hospital-a',
            status: 'ACTIVE',
            isPubliclyVisible: true,
          }),
        }),
      );
    });
  });

  describe('getDoctor / getAvailableSlots', () => {
    it('delegates visibility checking entirely to DoctorsService', async () => {
      doctorsService.getPubliclyVisibleDoctorOrThrow.mockResolvedValue({
        id: 'doctor-1',
        displayName: 'Dr. Rao',
        specialization: 'Cardiology',
        hospitalId: 'hospital-a',
        departmentId: 'dept-1',
      });
      prisma.hospital.findUniqueOrThrow.mockResolvedValue(publicHospital);
      prisma.department.findUniqueOrThrow.mockResolvedValue({ id: 'dept-1', name: 'Cardiology' });

      const result = await service.getDoctor('doctor-1');
      expect(result.displayName).toBe('Dr. Rao');
      expect(doctorsService.getPubliclyVisibleDoctorOrThrow).toHaveBeenCalledWith('doctor-1');
    });

    it('delegates slot computation entirely to DoctorsService.getPublicAvailableSlots', async () => {
      doctorsService.getPublicAvailableSlots.mockResolvedValue(['2027-01-01T03:30:00.000Z']);

      const result = await service.getAvailableSlots('doctor-1', '2027-01-01');
      expect(result).toEqual(['2027-01-01T03:30:00.000Z']);
      expect(doctorsService.getPublicAvailableSlots).toHaveBeenCalledWith('doctor-1', '2027-01-01');
    });
  });
});
