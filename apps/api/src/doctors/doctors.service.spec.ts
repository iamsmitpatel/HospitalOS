import { DoctorStatus, Role } from '@prisma/client';
import { DoctorsService } from './doctors.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('DoctorsService', () => {
  let prisma: any;
  let auditService: any;
  let departmentsService: any;
  let service: DoctorsService;

  const hospitalAdminA: AuthenticatedUser = {
    userId: 'admin-a',
    email: 'admin-a@hospitalos.dev',
    role: Role.HOSPITAL_ADMIN,
    hospitalId: 'hospital-a',
  };
  const doctorActor: AuthenticatedUser = {
    userId: 'user-doc-1',
    email: 'doc@hospitalos.dev',
    role: Role.DOCTOR,
    hospitalId: 'hospital-a',
  };
  const otherDoctorActor: AuthenticatedUser = {
    userId: 'user-doc-2',
    email: 'other-doc@hospitalos.dev',
    role: Role.DOCTOR,
    hospitalId: 'hospital-a',
  };

  const baseDoctorProfile = {
    id: 'doc-profile-1',
    userId: 'user-doc-1',
    hospitalId: 'hospital-a',
    departmentId: 'dept-1',
    specialization: 'Cardiology',
    displayName: 'Dr. Jane Doe',
    registrationNumber: null,
    status: DoctorStatus.ACTIVE,
    createdAt: new Date(),
    user: { firstName: 'Jane', lastName: 'Doe', email: 'doc@hospitalos.dev' },
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      doctorProfile: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      doctorSchedule: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      doctorUnavailability: { findMany: jest.fn(), create: jest.fn() },
      appointment: { findMany: jest.fn() },
      hospital: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    };
    auditService = { log: jest.fn() };
    departmentsService = { getTenantScopedDepartmentOrThrow: jest.fn() };
    service = new DoctorsService(prisma, auditService, departmentsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('rejects a target user that does not have the DOCTOR role', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        hospitalId: 'hospital-a',
        role: Role.NURSE,
        firstName: 'A',
        lastName: 'B',
      });

      await expect(
        service.create(
          { userId: 'u1', departmentId: 'dept-1', specialization: 'Cardiology' },
          hospitalAdminA,
        ),
      ).rejects.toMatchObject({ code: 'USER_NOT_A_DOCTOR' });
    });

    it('rejects a user who already has a doctor profile', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        hospitalId: 'hospital-a',
        role: Role.DOCTOR,
        firstName: 'A',
        lastName: 'B',
      });
      prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'existing-profile' });

      await expect(
        service.create(
          { userId: 'u1', departmentId: 'dept-1', specialization: 'Cardiology' },
          hospitalAdminA,
        ),
      ).rejects.toMatchObject({ code: 'DOCTOR_PROFILE_ALREADY_EXISTS' });
    });

    it('rejects a user belonging to a different hospital than the resolved tenant', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        hospitalId: 'hospital-b',
        role: Role.DOCTOR,
        firstName: 'A',
        lastName: 'B',
      });

      await expect(
        service.create(
          { userId: 'u1', departmentId: 'dept-1', specialization: 'Cardiology' },
          hospitalAdminA,
        ),
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    });

    it('defaults displayName to "Dr. {firstName} {lastName}" when not supplied', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        hospitalId: 'hospital-a',
        role: Role.DOCTOR,
        firstName: 'Jane',
        lastName: 'Doe',
      });
      prisma.doctorProfile.findUnique.mockResolvedValue(null);
      departmentsService.getTenantScopedDepartmentOrThrow.mockResolvedValue({
        id: 'dept-1',
        hospitalId: 'hospital-a',
      });
      prisma.doctorProfile.create.mockImplementation(({ data }: any) => ({
        ...data,
        id: 'profile-1',
        createdAt: new Date(),
        user: { firstName: 'Jane', lastName: 'Doe', email: 'doc@hospitalos.dev' },
      }));

      const result = await service.create(
        { userId: 'u1', departmentId: 'dept-1', specialization: 'Cardiology' },
        hospitalAdminA,
      );

      expect(result.displayName).toBe('Dr. Jane Doe');
    });
  });

  describe('schedule ownership', () => {
    it('allows a DOCTOR to manage their own schedule', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(baseDoctorProfile);
      prisma.doctorSchedule.findMany.mockResolvedValue([]);
      prisma.doctorSchedule.create.mockImplementation(({ data }: any) => ({
        id: 'sched-1',
        ...data,
      }));

      await expect(
        service.createSchedule(
          'doc-profile-1',
          { dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 15 },
          doctorActor,
        ),
      ).resolves.toMatchObject({ startTime: '09:00' });
    });

    it("forbids a DOCTOR from managing a different doctor's schedule", async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(baseDoctorProfile);

      await expect(
        service.createSchedule(
          'doc-profile-1',
          { dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00' },
          otherDoctorActor,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('schedule validation', () => {
    it('rejects endTime <= startTime', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(baseDoctorProfile);

      await expect(
        service.createSchedule(
          'doc-profile-1',
          { dayOfWeek: 'MONDAY', startTime: '12:00', endTime: '09:00' },
          hospitalAdminA,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_SCHEDULE_RANGE' });
    });

    it('rejects a schedule that overlaps an existing active schedule for the same day', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(baseDoctorProfile);
      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'existing',
          dayOfWeek: 'MONDAY',
          startTime: '09:00',
          endTime: '12:00',
          isActive: true,
        },
      ]);

      await expect(
        service.createSchedule(
          'doc-profile-1',
          { dayOfWeek: 'MONDAY', startTime: '11:00', endTime: '14:00' },
          hospitalAdminA,
        ),
      ).rejects.toMatchObject({ code: 'SCHEDULE_OVERLAP' });
    });

    it('allows a back-to-back (non-overlapping) schedule on the same day', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(baseDoctorProfile);
      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'existing',
          dayOfWeek: 'MONDAY',
          startTime: '09:00',
          endTime: '12:00',
          isActive: true,
        },
      ]);
      prisma.doctorSchedule.create.mockImplementation(({ data }: any) => ({
        id: 'sched-2',
        ...data,
      }));

      await expect(
        service.createSchedule(
          'doc-profile-1',
          { dayOfWeek: 'MONDAY', startTime: '12:00', endTime: '14:00' },
          hospitalAdminA,
        ),
      ).resolves.toMatchObject({ startTime: '12:00' });
    });
  });

  describe('getAvailableSlots', () => {
    // 2027-10-11 is a Monday, far enough in the future to avoid "past slot" filtering.
    const FUTURE_MONDAY = '2027-10-11';

    beforeEach(() => {
      prisma.hospital.findUniqueOrThrow.mockResolvedValue({
        id: 'hospital-a',
        timezone: 'Asia/Kolkata',
      });
    });

    it('returns an empty array for an INACTIVE doctor', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue({
        ...baseDoctorProfile,
        status: DoctorStatus.INACTIVE,
      });

      const slots = await service.getAvailableSlots('doc-profile-1', FUTURE_MONDAY, hospitalAdminA);
      expect(slots).toEqual([]);
    });

    it('returns an empty array when there is no schedule for that day of week', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(baseDoctorProfile);
      prisma.doctorSchedule.findMany.mockResolvedValue([]);

      const slots = await service.getAvailableSlots('doc-profile-1', FUTURE_MONDAY, hospitalAdminA);
      expect(slots).toEqual([]);
    });

    it('generates slots inclusive of the schedule end boundary, excludes booked and unavailable times', async () => {
      prisma.doctorProfile.findUnique.mockResolvedValue(baseDoctorProfile);
      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          doctorProfileId: 'doc-profile-1',
          dayOfWeek: 'MONDAY',
          startTime: '09:00',
          endTime: '10:00',
          slotDurationMinutes: 15,
          isActive: true,
        },
      ]);
      // 09:30 IST booked.
      const bookedInstant = new Date('2027-10-11T04:00:00.000Z'); // 09:30 IST
      prisma.appointment.findMany.mockResolvedValue([{ scheduledAt: bookedInstant }]);
      // 09:45-10:00 IST blocked by unavailability.
      prisma.doctorUnavailability.findMany.mockResolvedValue([
        {
          startAt: new Date('2027-10-11T04:15:00.000Z'),
          endAt: new Date('2027-10-11T04:30:00.000Z'),
        },
      ]);

      const slots = await service.getAvailableSlots('doc-profile-1', FUTURE_MONDAY, hospitalAdminA);

      // Window 09:00-10:00, 15-min slots -> candidates 09:00,09:15,09:30,09:45 (inclusive boundary).
      // 09:30 booked, 09:45 unavailable -> only 09:00 and 09:15 remain.
      expect(slots).toEqual([
        '2027-10-11T03:30:00.000Z', // 09:00 IST
        '2027-10-11T03:45:00.000Z', // 09:15 IST
      ]);
    });

    it('excludes slots that have already passed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-10-11T03:40:00.000Z')); // 09:10 IST
      prisma.doctorProfile.findUnique.mockResolvedValue(baseDoctorProfile);
      prisma.doctorSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          doctorProfileId: 'doc-profile-1',
          dayOfWeek: 'MONDAY',
          startTime: '09:00',
          endTime: '09:30',
          slotDurationMinutes: 15,
          isActive: true,
        },
      ]);
      prisma.appointment.findMany.mockResolvedValue([]);
      prisma.doctorUnavailability.findMany.mockResolvedValue([]);

      const slots = await service.getAvailableSlots('doc-profile-1', FUTURE_MONDAY, hospitalAdminA);

      // 09:00 has passed (now is 09:10); 09:15 has not.
      expect(slots).toEqual(['2027-10-11T03:45:00.000Z']);
    });
  });
});
