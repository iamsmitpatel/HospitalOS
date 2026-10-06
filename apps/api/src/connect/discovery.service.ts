import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorsService } from '../doctors/doctors.service';
import { DiscoverHospitalsQueryDto } from './dto/discover-hospitals-query.dto';
import { DiscoverDoctorsQueryDto } from './dto/discover-doctors-query.dto';
import {
  PaginatedPublicHospitalsResponseDto,
  PublicDepartmentResponseDto,
  PublicDoctorResponseDto,
  PublicHospitalResponseDto,
} from './dto/public-hospital-response.dto';

/**
 * HospitalOS Connect public discovery (Phase 5). Every method here is
 * reachable with NO authentication (@Public() on the controller) — the
 * only gate is Hospital.isPublic / DoctorProfile.isPubliclyVisible /
 * DoctorStatus.ACTIVE, never a permission or tenant check. Every response
 * DTO is a hand-picked field list (see public-hospital-response.dto.ts) —
 * never a raw Prisma row, so a schema addition elsewhere in the app can
 * never silently leak through a public endpoint.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly doctorsService: DoctorsService,
  ) {}

  async listHospitals(
    query: DiscoverHospitalsQueryDto,
  ): Promise<PaginatedPublicHospitalsResponseDto> {
    const where: Prisma.HospitalWhereInput = { isPublic: true, isActive: true };
    if (query.city) {
      where.city = { contains: query.city, mode: 'insensitive' };
    }
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.hospital.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.hospital.count({ where }),
    ]);

    return { items: items.map((h) => this.toPublicHospital(h)), total, page, pageSize };
  }

  async getHospital(id: string): Promise<PublicHospitalResponseDto> {
    const hospital = await this.getPublicHospitalOrThrow(id);
    return this.toPublicHospital(hospital);
  }

  async listDepartments(hospitalId: string): Promise<PublicDepartmentResponseDto[]> {
    await this.getPublicHospitalOrThrow(hospitalId);
    const departments = await this.prisma.department.findMany({
      where: { hospitalId, isActive: true },
      orderBy: { name: 'asc' },
    });
    return departments.map((d) => ({ id: d.id, name: d.name, description: d.description }));
  }

  async listDoctors(
    hospitalId: string,
    query: DiscoverDoctorsQueryDto,
  ): Promise<PublicDoctorResponseDto[]> {
    const hospital = await this.getPublicHospitalOrThrow(hospitalId);
    const doctors = await this.prisma.doctorProfile.findMany({
      where: {
        hospitalId,
        status: 'ACTIVE',
        isPubliclyVisible: true,
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.specialization
          ? { specialization: { contains: query.specialization, mode: 'insensitive' } }
          : {}),
      },
      include: { department: { select: { id: true, name: true } } },
      orderBy: { displayName: 'asc' },
    });
    return doctors.map((d) => ({
      id: d.id,
      displayName: d.displayName,
      specialization: d.specialization,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      departmentId: d.department.id,
      departmentName: d.department.name,
    }));
  }

  async getDoctor(id: string): Promise<PublicDoctorResponseDto> {
    const doctor = await this.doctorsService.getPubliclyVisibleDoctorOrThrow(id);
    const [hospital, department] = await Promise.all([
      this.prisma.hospital.findUniqueOrThrow({ where: { id: doctor.hospitalId } }),
      this.prisma.department.findUniqueOrThrow({ where: { id: doctor.departmentId } }),
    ]);
    return {
      id: doctor.id,
      displayName: doctor.displayName,
      specialization: doctor.specialization,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      departmentId: department.id,
      departmentName: department.name,
    };
  }

  async getAvailableSlots(doctorId: string, date: string): Promise<string[]> {
    return this.doctorsService.getPublicAvailableSlots(doctorId, date);
  }

  private async getPublicHospitalOrThrow(id: string) {
    const hospital = await this.prisma.hospital.findUnique({ where: { id } });
    if (!hospital || !hospital.isPublic || !hospital.isActive) {
      throw new AppException('HOSPITAL_NOT_FOUND', 'Hospital not found.', HttpStatus.NOT_FOUND);
    }
    return hospital;
  }

  private toPublicHospital(hospital: {
    id: string;
    name: string;
    slug: string;
    publicDescription: string | null;
    addressLine: string | null;
    city: string | null;
    publicPhone: string | null;
    publicEmail: string | null;
    operatingHours: string | null;
  }): PublicHospitalResponseDto {
    return {
      id: hospital.id,
      name: hospital.name,
      slug: hospital.slug,
      publicDescription: hospital.publicDescription,
      addressLine: hospital.addressLine,
      city: hospital.city,
      publicPhone: hospital.publicPhone,
      publicEmail: hospital.publicEmail,
      operatingHours: hospital.operatingHours,
    };
  }
}
