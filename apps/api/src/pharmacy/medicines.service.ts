import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Medicine, Role } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenant, resolveTenantHospitalId } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { MedicineResponseDto } from './dto/medicine-response.dto';

/** Catalog data, same tenant-resolution rule as LabTestsService/DepartmentsService — see there for the rationale. */
@Injectable()
export class MedicinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateMedicineDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<MedicineResponseDto> {
    const hospitalId = await resolveTenantHospitalId(this.prisma, actor, undefined);

    const medicine = await this.prisma.medicine.create({
      data: {
        hospitalId,
        name: dto.name,
        genericName: dto.genericName,
        brandName: dto.brandName,
        strength: dto.strength,
        form: dto.form,
        unit: dto.unit,
      },
    });

    await this.auditService.log({
      action: AuditAction.MEDICINE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId,
      resourceType: 'Medicine',
      resourceId: medicine.id,
      correlationId,
    });

    return this.toResponse(medicine);
  }

  async findAllForTenant(
    actor: AuthenticatedUser,
    isActive?: boolean,
  ): Promise<MedicineResponseDto[]> {
    if (actor.role === Role.SUPER_ADMIN) {
      const medicines = await this.prisma.medicine.findMany({
        where: isActive === undefined ? {} : { isActive },
        orderBy: { name: 'asc' },
      });
      return medicines.map((m) => this.toResponse(m));
    }
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }
    const medicines = await this.prisma.medicine.findMany({
      where: { hospitalId: actor.hospitalId, ...(isActive === undefined ? {} : { isActive }) },
      orderBy: { name: 'asc' },
    });
    return medicines.map((m) => this.toResponse(m));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<MedicineResponseDto> {
    const medicine = await this.getTenantScopedMedicineOrThrow(id, actor);
    return this.toResponse(medicine);
  }

  async update(
    id: string,
    dto: UpdateMedicineDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<MedicineResponseDto> {
    const medicine = await this.getTenantScopedMedicineOrThrow(id, actor);

    const updated = await this.prisma.medicine.update({
      where: { id: medicine.id },
      data: {
        name: dto.name,
        genericName: dto.genericName,
        brandName: dto.brandName,
        strength: dto.strength,
        form: dto.form,
        unit: dto.unit,
        isActive: dto.isActive,
      },
    });

    await this.auditService.log({
      action: AuditAction.MEDICINE_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'Medicine',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  /** Used by stock-batches.service.ts / dispense.service.ts to validate a medicine reference. */
  async getTenantScopedMedicineOrThrow(id: string, actor: AuthenticatedUser): Promise<Medicine> {
    const medicine = await this.prisma.medicine.findUnique({ where: { id } });
    if (!medicine) {
      throw new AppException('MEDICINE_NOT_FOUND', 'Medicine not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenant(medicine.hospitalId, actor, 'MEDICINE_NOT_FOUND', 'Medicine not found.');
    return medicine;
  }

  private toResponse(medicine: Medicine): MedicineResponseDto {
    return {
      id: medicine.id,
      hospitalId: medicine.hospitalId,
      name: medicine.name,
      genericName: medicine.genericName,
      brandName: medicine.brandName,
      strength: medicine.strength,
      form: medicine.form,
      unit: medicine.unit,
      isActive: medicine.isActive,
      createdAt: medicine.createdAt,
    };
  }
}
