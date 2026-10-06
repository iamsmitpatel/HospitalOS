import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, LabTest, Role } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenant, resolveTenantHospitalId } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { CreateLabTestDto } from './dto/create-lab-test.dto';
import { UpdateLabTestDto } from './dto/update-lab-test.dto';
import { LabTestResponseDto } from './dto/lab-test-response.dto';

/**
 * Catalog data (master doc §20), same tenant-resolution rule as
 * Department/Doctor: a SUPER_ADMIN may administer any hospital's catalog,
 * never a specific patient's clinical data (§14) — see tenant.util.ts.
 */
@Injectable()
export class LabTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateLabTestDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<LabTestResponseDto> {
    const hospitalId = await resolveTenantHospitalId(this.prisma, actor, undefined);

    const existing = await this.prisma.labTest.findUnique({
      where: { hospitalId_code: { hospitalId, code: dto.code } },
    });
    if (existing) {
      throw new AppException(
        'LAB_TEST_CODE_TAKEN',
        'A lab test with this code already exists in this hospital.',
        HttpStatus.CONFLICT,
      );
    }

    const labTest = await this.prisma.labTest.create({
      data: {
        hospitalId,
        name: dto.name,
        code: dto.code,
        category: dto.category,
        sampleType: dto.sampleType,
        unit: dto.unit,
        referenceRangeLow: dto.referenceRangeLow,
        referenceRangeHigh: dto.referenceRangeHigh,
      },
    });

    await this.auditService.log({
      action: AuditAction.LABTEST_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId,
      resourceType: 'LabTest',
      resourceId: labTest.id,
      correlationId,
    });

    return this.toResponse(labTest);
  }

  async findAllForTenant(
    actor: AuthenticatedUser,
    isActive?: boolean,
  ): Promise<LabTestResponseDto[]> {
    if (actor.role === Role.SUPER_ADMIN) {
      const labTests = await this.prisma.labTest.findMany({
        where: isActive === undefined ? {} : { isActive },
        orderBy: { name: 'asc' },
      });
      return labTests.map((t) => this.toResponse(t));
    }
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }
    const labTests = await this.prisma.labTest.findMany({
      where: { hospitalId: actor.hospitalId, ...(isActive === undefined ? {} : { isActive }) },
      orderBy: { name: 'asc' },
    });
    return labTests.map((t) => this.toResponse(t));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<LabTestResponseDto> {
    const labTest = await this.getTenantScopedLabTestOrThrow(id, actor);
    return this.toResponse(labTest);
  }

  async update(
    id: string,
    dto: UpdateLabTestDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<LabTestResponseDto> {
    const labTest = await this.getTenantScopedLabTestOrThrow(id, actor);

    const updated = await this.prisma.labTest.update({
      where: { id: labTest.id },
      data: {
        name: dto.name,
        category: dto.category,
        sampleType: dto.sampleType,
        unit: dto.unit,
        referenceRangeLow: dto.referenceRangeLow,
        referenceRangeHigh: dto.referenceRangeHigh,
        isActive: dto.isActive,
      },
    });

    await this.auditService.log({
      action: AuditAction.LABTEST_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'LabTest',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  /** Used by lab-orders.service.ts to validate a labTestId reference without duplicating the tenant check. */
  async getTenantScopedLabTestOrThrow(id: string, actor: AuthenticatedUser): Promise<LabTest> {
    const labTest = await this.prisma.labTest.findUnique({ where: { id } });
    if (!labTest) {
      throw new AppException('LAB_TEST_NOT_FOUND', 'Lab test not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenant(labTest.hospitalId, actor, 'LAB_TEST_NOT_FOUND', 'Lab test not found.');
    return labTest;
  }

  private toResponse(labTest: LabTest): LabTestResponseDto {
    return {
      id: labTest.id,
      hospitalId: labTest.hospitalId,
      name: labTest.name,
      code: labTest.code,
      category: labTest.category,
      sampleType: labTest.sampleType,
      unit: labTest.unit,
      referenceRangeLow: labTest.referenceRangeLow?.toString() ?? null,
      referenceRangeHigh: labTest.referenceRangeHigh?.toString() ?? null,
      isActive: labTest.isActive,
      createdAt: labTest.createdAt,
    };
  }
}
