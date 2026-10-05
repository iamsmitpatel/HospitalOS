import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Hospital, Role } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { HospitalResponseDto } from './dto/hospital-response.dto';

@Injectable()
export class HospitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateHospitalDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<HospitalResponseDto> {
    const existing = await this.prisma.hospital.findFirst({
      where: { OR: [{ slug: dto.slug }, { code: dto.code }] },
    });
    if (existing) {
      const field = existing.slug === dto.slug ? 'slug' : 'code';
      throw new AppException(
        'HOSPITAL_IDENTIFIER_TAKEN',
        `A hospital with this ${field} already exists.`,
        HttpStatus.CONFLICT,
      );
    }

    const hospital = await this.prisma.hospital.create({
      data: { name: dto.name, slug: dto.slug, code: dto.code },
    });

    await this.auditService.log({
      action: AuditAction.HOSPITAL_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: hospital.id,
      resourceType: 'Hospital',
      resourceId: hospital.id,
      correlationId,
    });

    return this.toResponse(hospital);
  }

  async findAll(actor: AuthenticatedUser): Promise<HospitalResponseDto[]> {
    // Only a platform SUPER_ADMIN can browse the full tenant list; a
    // hospital-scoped user has no legitimate reason to enumerate other tenants.
    if (actor.role !== Role.SUPER_ADMIN) {
      throw new AppException(
        'FORBIDDEN',
        'Only a platform administrator can list hospitals.',
        HttpStatus.FORBIDDEN,
      );
    }
    const hospitals = await this.prisma.hospital.findMany({ orderBy: { createdAt: 'desc' } });
    return hospitals.map((h) => this.toResponse(h));
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<HospitalResponseDto> {
    const hospital = await this.getTenantScopedHospitalOrThrow(id, actor);
    return this.toResponse(hospital);
  }

  async update(
    id: string,
    dto: UpdateHospitalDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<HospitalResponseDto> {
    // Deactivating/renaming a tenant is platform-level; enforced via @Roles on
    // the controller as well, but re-checked here in case the service is
    // ever called from another path.
    if (actor.role !== Role.SUPER_ADMIN) {
      throw new AppException(
        'FORBIDDEN',
        'Only a platform administrator can update a hospital.',
        HttpStatus.FORBIDDEN,
      );
    }

    const hospital = await this.getTenantScopedHospitalOrThrow(id, actor);
    const updated = await this.prisma.hospital.update({
      where: { id: hospital.id },
      data: { name: dto.name, isActive: dto.isActive },
    });

    await this.auditService.log({
      action: AuditAction.HOSPITAL_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.id,
      resourceType: 'Hospital',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  private async getTenantScopedHospitalOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Hospital> {
    const hospital = await this.prisma.hospital.findUnique({ where: { id } });
    if (!hospital || (actor.role !== Role.SUPER_ADMIN && hospital.id !== actor.hospitalId)) {
      throw new AppException('HOSPITAL_NOT_FOUND', 'Hospital not found.', HttpStatus.NOT_FOUND);
    }
    return hospital;
  }

  private toResponse(hospital: Hospital): HospitalResponseDto {
    return {
      id: hospital.id,
      name: hospital.name,
      slug: hospital.slug,
      code: hospital.code,
      isActive: hospital.isActive,
      createdAt: hospital.createdAt,
    };
  }
}
