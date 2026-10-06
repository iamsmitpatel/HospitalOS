import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AuditOutcome,
  DoctorProfile,
  DoctorSchedule,
  DoctorStatus,
  DoctorUnavailability,
  Role,
} from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenant, resolveTenantHospitalId } from '../common/utils/tenant.util';
import {
  addMinutesToHhMm,
  compareHhMm,
  getZonedDateParts,
  zonedWallTimeToUtc,
} from '../common/utils/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { DepartmentsService } from '../departments/departments.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { DoctorResponseDto } from './dto/doctor-response.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ScheduleResponseDto } from './dto/schedule-response.dto';
import { CreateUnavailabilityDto } from './dto/create-unavailability.dto';
import { UnavailabilityResponseDto } from './dto/unavailability-response.dto';

export interface DoctorQuery {
  departmentId?: string;
  specialization?: string;
  status?: DoctorStatus;
}

type DoctorProfileWithUser = DoctorProfile & {
  user: { firstName: string; lastName: string; email: string };
};

@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly departmentsService: DepartmentsService,
  ) {}

  async create(
    dto: CreateDoctorDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<DoctorResponseDto> {
    const hospitalId = await resolveTenantHospitalId(this.prisma, actor, dto.hospitalId);

    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user || user.hospitalId !== hospitalId) {
      throw new AppException('USER_NOT_FOUND', 'User not found.', HttpStatus.NOT_FOUND);
    }
    if (user.role !== Role.DOCTOR) {
      throw new AppException(
        'USER_NOT_A_DOCTOR',
        'Target user does not have the DOCTOR role.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const existingProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId: user.id },
    });
    if (existingProfile) {
      throw new AppException(
        'DOCTOR_PROFILE_ALREADY_EXISTS',
        'This user already has a doctor profile.',
        HttpStatus.CONFLICT,
      );
    }

    // Reuses DepartmentsService's own tenant check rather than duplicating it.
    const department = await this.departmentsService.getTenantScopedDepartmentOrThrow(
      dto.departmentId,
      actor,
    );
    if (department.hospitalId !== hospitalId) {
      throw new AppException('DEPARTMENT_NOT_FOUND', 'Department not found.', HttpStatus.NOT_FOUND);
    }

    if (dto.registrationNumber) {
      const taken = await this.prisma.doctorProfile.findFirst({
        where: { hospitalId, registrationNumber: dto.registrationNumber },
      });
      if (taken) {
        throw new AppException(
          'REGISTRATION_NUMBER_TAKEN',
          'A doctor with this registration number already exists in this hospital.',
          HttpStatus.CONFLICT,
        );
      }
    }

    const doctorProfile = await this.prisma.doctorProfile.create({
      data: {
        userId: user.id,
        hospitalId,
        departmentId: department.id,
        specialization: dto.specialization,
        displayName: dto.displayName ?? `Dr. ${user.firstName} ${user.lastName}`,
        registrationNumber: dto.registrationNumber,
      },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });

    await this.auditService.log({
      action: AuditAction.DOCTOR_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId,
      resourceType: 'DoctorProfile',
      resourceId: doctorProfile.id,
      correlationId,
    });

    return this.toResponse(doctorProfile);
  }

  async findAllForTenant(
    actor: AuthenticatedUser,
    query: DoctorQuery,
  ): Promise<DoctorResponseDto[]> {
    const filters = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.specialization
        ? { specialization: { contains: query.specialization, mode: 'insensitive' as const } }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    if (actor.role === Role.SUPER_ADMIN) {
      const doctors = await this.prisma.doctorProfile.findMany({
        where: filters,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { displayName: 'asc' },
      });
      return doctors.map((d) => this.toResponse(d));
    }
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }
    const doctors = await this.prisma.doctorProfile.findMany({
      where: { hospitalId: actor.hospitalId, ...filters },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { displayName: 'asc' },
    });
    return doctors.map((d) => this.toResponse(d));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<DoctorResponseDto> {
    const doctor = await this.getTenantScopedDoctorOrThrow(id, actor);
    return this.toResponse(doctor);
  }

  async update(
    id: string,
    dto: UpdateDoctorDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<DoctorResponseDto> {
    const doctor = await this.getTenantScopedDoctorOrThrow(id, actor);

    if (dto.departmentId && dto.departmentId !== doctor.departmentId) {
      const department = await this.departmentsService.getTenantScopedDepartmentOrThrow(
        dto.departmentId,
        actor,
      );
      if (department.hospitalId !== doctor.hospitalId) {
        throw new AppException(
          'DEPARTMENT_NOT_FOUND',
          'Department not found.',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    if (dto.registrationNumber && dto.registrationNumber !== doctor.registrationNumber) {
      const taken = await this.prisma.doctorProfile.findFirst({
        where: {
          hospitalId: doctor.hospitalId,
          registrationNumber: dto.registrationNumber,
          id: { not: doctor.id },
        },
      });
      if (taken) {
        throw new AppException(
          'REGISTRATION_NUMBER_TAKEN',
          'A doctor with this registration number already exists in this hospital.',
          HttpStatus.CONFLICT,
        );
      }
    }

    const updated = await this.prisma.doctorProfile.update({
      where: { id: doctor.id },
      data: {
        departmentId: dto.departmentId,
        specialization: dto.specialization,
        displayName: dto.displayName,
        registrationNumber: dto.registrationNumber,
        status: dto.status,
      },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });

    await this.auditService.log({
      action:
        dto.status && dto.status !== DoctorStatus.ACTIVE
          ? AuditAction.DOCTOR_DEACTIVATED
          : AuditAction.DOCTOR_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'DoctorProfile',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  /** Used by appointments.service.ts / queue.service.ts to validate a doctor reference. */
  async getTenantScopedDoctorOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<DoctorProfileWithUser> {
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    if (!doctor) {
      throw new AppException('DOCTOR_NOT_FOUND', 'Doctor not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenant(doctor.hospitalId, actor, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
    return doctor;
  }

  // ---------------------------------------------------------------------
  // Schedules
  // ---------------------------------------------------------------------

  async createSchedule(
    doctorId: string,
    dto: CreateScheduleDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<ScheduleResponseDto> {
    const doctor = await this.getTenantScopedDoctorOrThrow(doctorId, actor);
    this.assertCanManageSchedule(doctor, actor);

    if (compareHhMm(dto.startTime, dto.endTime) >= 0) {
      throw new AppException(
        'INVALID_SCHEDULE_RANGE',
        'endTime must be strictly after startTime.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.assertNoScheduleOverlap(doctor.id, dto.dayOfWeek, dto.startTime, dto.endTime);

    const schedule = await this.prisma.doctorSchedule.create({
      data: {
        doctorProfileId: doctor.id,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        slotDurationMinutes: dto.slotDurationMinutes ?? 15,
      },
    });

    await this.auditService.log({
      action: AuditAction.DOCTOR_SCHEDULE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: doctor.hospitalId,
      resourceType: 'DoctorSchedule',
      resourceId: schedule.id,
      correlationId,
    });

    return this.toScheduleResponse(schedule);
  }

  async listSchedules(doctorId: string, actor: AuthenticatedUser): Promise<ScheduleResponseDto[]> {
    const doctor = await this.getTenantScopedDoctorOrThrow(doctorId, actor);
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: { doctorProfileId: doctor.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return schedules.map((s) => this.toScheduleResponse(s));
  }

  async updateSchedule(
    scheduleId: string,
    dto: UpdateScheduleDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<ScheduleResponseDto> {
    const schedule = await this.prisma.doctorSchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) {
      throw new AppException('SCHEDULE_NOT_FOUND', 'Schedule not found.', HttpStatus.NOT_FOUND);
    }
    const doctor = await this.getTenantScopedDoctorOrThrow(schedule.doctorProfileId, actor);
    this.assertCanManageSchedule(doctor, actor);

    const nextStart = dto.startTime ?? schedule.startTime;
    const nextEnd = dto.endTime ?? schedule.endTime;
    if (compareHhMm(nextStart, nextEnd) >= 0) {
      throw new AppException(
        'INVALID_SCHEDULE_RANGE',
        'endTime must be strictly after startTime.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.startTime || dto.endTime) {
      await this.assertNoScheduleOverlap(
        doctor.id,
        schedule.dayOfWeek,
        nextStart,
        nextEnd,
        schedule.id,
      );
    }

    const updated = await this.prisma.doctorSchedule.update({
      where: { id: schedule.id },
      data: {
        startTime: dto.startTime,
        endTime: dto.endTime,
        slotDurationMinutes: dto.slotDurationMinutes,
        isActive: dto.isActive,
      },
    });

    await this.auditService.log({
      action: AuditAction.DOCTOR_SCHEDULE_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: doctor.hospitalId,
      resourceType: 'DoctorSchedule',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toScheduleResponse(updated);
  }

  // ---------------------------------------------------------------------
  // Unavailability
  // ---------------------------------------------------------------------

  async createUnavailability(
    doctorId: string,
    dto: CreateUnavailabilityDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<UnavailabilityResponseDto> {
    const doctor = await this.getTenantScopedDoctorOrThrow(doctorId, actor);
    this.assertCanManageSchedule(doctor, actor);

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt.getTime() <= startAt.getTime()) {
      throw new AppException(
        'INVALID_UNAVAILABILITY_RANGE',
        'endAt must be after startAt.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const unavailability = await this.prisma.doctorUnavailability.create({
      data: { doctorProfileId: doctor.id, startAt, endAt, reason: dto.reason },
    });

    await this.auditService.log({
      action: AuditAction.DOCTOR_UNAVAILABILITY_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: doctor.hospitalId,
      resourceType: 'DoctorUnavailability',
      resourceId: unavailability.id,
      correlationId,
    });

    return this.toUnavailabilityResponse(unavailability);
  }

  async listUnavailability(
    doctorId: string,
    actor: AuthenticatedUser,
  ): Promise<UnavailabilityResponseDto[]> {
    const doctor = await this.getTenantScopedDoctorOrThrow(doctorId, actor);
    const entries = await this.prisma.doctorUnavailability.findMany({
      where: { doctorProfileId: doctor.id },
      orderBy: { startAt: 'asc' },
    });
    return entries.map((e) => this.toUnavailabilityResponse(e));
  }

  // ---------------------------------------------------------------------
  // Available slots (master doc §36-37) — computed, not persisted.
  // ---------------------------------------------------------------------

  async getAvailableSlots(
    doctorId: string,
    dateStr: string,
    actor: AuthenticatedUser,
  ): Promise<string[]> {
    const doctor = await this.getTenantScopedDoctorOrThrow(doctorId, actor);
    const hospital = await this.prisma.hospital.findUniqueOrThrow({
      where: { id: doctor.hospitalId },
    });

    if (doctor.status !== DoctorStatus.ACTIVE) {
      return [];
    }

    // A calendar date's day-of-week is timezone-independent — only the
    // conversion of specific wall-clock times to UTC instants needs the
    // hospital's timezone (see /DATABASE.md).
    const dayOfWeek = getZonedDateParts('UTC', new Date(`${dateStr}T00:00:00.000Z`)).dayOfWeek;

    const schedules = await this.prisma.doctorSchedule.findMany({
      where: { doctorProfileId: doctor.id, dayOfWeek, isActive: true },
    });
    if (schedules.length === 0) {
      return [];
    }

    const dayStartUtc = zonedWallTimeToUtc(hospital.timezone, dateStr, '00:00');
    const nextDate = new Date(`${dateStr}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 10);
    const dayEndUtc = zonedWallTimeToUtc(hospital.timezone, nextDateStr, '00:00');

    const [unavailabilities, bookedAppointments] = await Promise.all([
      this.prisma.doctorUnavailability.findMany({
        where: {
          doctorProfileId: doctor.id,
          startAt: { lt: dayEndUtc },
          endAt: { gt: dayStartUtc },
        },
      }),
      this.prisma.appointment.findMany({
        where: {
          doctorProfileId: doctor.id,
          scheduledAt: { gte: dayStartUtc, lt: dayEndUtc },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
        select: { scheduledAt: true },
      }),
    ]);
    const bookedTimes = new Set(bookedAppointments.map((a) => a.scheduledAt.getTime()));

    const now = new Date();
    const slots: string[] = [];

    for (const schedule of schedules) {
      let candidate = schedule.startTime;
      // A slot is valid if it fully fits within the window — the final
      // slot may end exactly AT the boundary (master doc §36), hence <=.
      while (
        compareHhMm(addMinutesToHhMm(candidate, schedule.slotDurationMinutes), schedule.endTime) <=
        0
      ) {
        const instant = zonedWallTimeToUtc(hospital.timezone, dateStr, candidate);
        const isPast = instant.getTime() <= now.getTime();
        const isBooked = bookedTimes.has(instant.getTime());
        const isUnavailable = unavailabilities.some(
          (u) => instant >= u.startAt && instant < u.endAt,
        );
        if (!isPast && !isBooked && !isUnavailable) {
          slots.push(instant.toISOString());
        }
        candidate = addMinutesToHhMm(candidate, schedule.slotDurationMinutes);
      }
    }

    return slots.sort();
  }

  // ---------------------------------------------------------------------

  private assertCanManageSchedule(doctor: DoctorProfile, actor: AuthenticatedUser): void {
    if (actor.role === Role.SUPER_ADMIN || actor.role === Role.HOSPITAL_ADMIN) {
      return;
    }
    if (actor.role === Role.DOCTOR && doctor.userId === actor.userId) {
      return;
    }
    throw new AppException(
      'FORBIDDEN',
      'You can only manage your own schedule.',
      HttpStatus.FORBIDDEN,
    );
  }

  private async assertNoScheduleOverlap(
    doctorProfileId: string,
    dayOfWeek: DoctorSchedule['dayOfWeek'],
    startTime: string,
    endTime: string,
    excludeScheduleId?: string,
  ): Promise<void> {
    const existing = await this.prisma.doctorSchedule.findMany({
      where: {
        doctorProfileId,
        dayOfWeek,
        isActive: true,
        ...(excludeScheduleId ? { id: { not: excludeScheduleId } } : {}),
      },
    });
    const overlaps = existing.some(
      (s) => compareHhMm(startTime, s.endTime) < 0 && compareHhMm(endTime, s.startTime) > 0,
    );
    if (overlaps) {
      throw new AppException(
        'SCHEDULE_OVERLAP',
        'This schedule overlaps with an existing active schedule for the same day.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private toResponse(doctor: DoctorProfileWithUser): DoctorResponseDto {
    return {
      id: doctor.id,
      userId: doctor.userId,
      hospitalId: doctor.hospitalId,
      departmentId: doctor.departmentId,
      specialization: doctor.specialization,
      displayName: doctor.displayName,
      registrationNumber: doctor.registrationNumber,
      status: doctor.status,
      firstName: doctor.user.firstName,
      lastName: doctor.user.lastName,
      email: doctor.user.email,
      createdAt: doctor.createdAt,
    };
  }

  private toScheduleResponse(schedule: DoctorSchedule): ScheduleResponseDto {
    return {
      id: schedule.id,
      doctorProfileId: schedule.doctorProfileId,
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      slotDurationMinutes: schedule.slotDurationMinutes,
      isActive: schedule.isActive,
    };
  }

  private toUnavailabilityResponse(entry: DoctorUnavailability): UnavailabilityResponseDto {
    return {
      id: entry.id,
      doctorProfileId: entry.doctorProfileId,
      startAt: entry.startAt,
      endAt: entry.endAt,
      reason: entry.reason,
    };
  }
}
