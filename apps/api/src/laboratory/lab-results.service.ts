import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, LabResult } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { LabOrdersService } from './lab-orders.service';
import { CreateLabResultDto } from './dto/create-lab-result.dto';
import { UpdateLabResultDto } from './dto/update-lab-result.dto';
import { LabResultResponseDto } from './dto/lab-result-response.dto';

@Injectable()
export class LabResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly labOrdersService: LabOrdersService,
  ) {}

  async create(
    itemId: string,
    dto: CreateLabResultDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<LabResultResponseDto> {
    const item = await this.labOrdersService.getTenantScopedLabOrderItemOrThrow(itemId, actor);

    if (item.status !== 'COLLECTED') {
      throw new AppException(
        'LAB_ORDER_ITEM_NOT_COLLECTED',
        `Cannot enter a result for an item in status ${item.status}. Collect the specimen first.`,
        HttpStatus.CONFLICT,
      );
    }
    if (item.result) {
      throw new AppException(
        'LAB_RESULT_ALREADY_ENTERED',
        'A result already exists for this item. Edit it, or amend it once verified.',
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.labResult.create({
        data: {
          hospitalId: item.labOrder.hospitalId,
          labOrderItemId: item.id,
          patientId: item.labOrder.patientId,
          value: dto.value,
          unit: dto.unit,
          referenceRange: dto.referenceRange,
          flag: dto.flag,
          enteredByUserId: actor.userId,
        },
      });
      await tx.labOrderItem.update({ where: { id: item.id }, data: { status: 'COMPLETED' } });
      await this.labOrdersService.recomputeOrderStatus(item.labOrderId, tx);
      return created;
    });

    await this.auditService.log({
      action: AuditAction.LAB_RESULT_ENTERED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: item.labOrder.hospitalId,
      resourceType: 'LabResult',
      resourceId: result.id,
      correlationId,
    });

    return this.toResponse(result);
  }

  async update(
    id: string,
    dto: UpdateLabResultDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<LabResultResponseDto> {
    const result = await this.getTenantScopedLabResultOrThrow(id, actor);

    if (result.status !== 'ENTERED') {
      throw new AppException(
        'LAB_RESULT_NOT_EDITABLE',
        `Cannot edit a result in status ${result.status}. Once verified, use amend instead.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.labResult.update({
      where: { id: result.id },
      data: {
        value: dto.value,
        unit: dto.unit,
        referenceRange: dto.referenceRange,
        flag: dto.flag,
      },
    });

    await this.auditService.log({
      action: AuditAction.LAB_RESULT_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'LabResult',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  /** Maker-checker (master doc §32): verifiedByUserId must differ from enteredByUserId. */
  async verify(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<LabResultResponseDto> {
    const result = await this.getTenantScopedLabResultOrThrow(id, actor);

    if (result.status !== 'ENTERED') {
      throw new AppException(
        'LAB_RESULT_NOT_PENDING_VERIFICATION',
        `Cannot verify a result in status ${result.status}.`,
        HttpStatus.CONFLICT,
      );
    }
    if (result.enteredByUserId === actor.userId) {
      throw new AppException(
        'SELF_VERIFICATION_FORBIDDEN',
        'The person who entered a result cannot also verify it.',
        HttpStatus.FORBIDDEN,
      );
    }

    const updated = await this.prisma.labResult.update({
      where: { id: result.id },
      data: { status: 'VERIFIED', verifiedByUserId: actor.userId, verifiedAt: new Date() },
    });

    await this.auditService.log({
      action: AuditAction.LAB_RESULT_VERIFIED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'LabResult',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  /**
   * Amendment-chain pattern (master doc §33) adapted to LabResult's
   * labOrderItemId @unique constraint — a result can never share its item
   * with another result, so a correction cannot reuse the original item the
   * way Diagnosis/Prescription amendments reuse their parent encounter.
   * Instead, amending creates a fresh LabOrderItem (same test, same order)
   * carrying the corrected value, linked back via amendsId — the original
   * result (and its item) stay on the chart untouched except for the
   * AMENDED status flip. See /DECISIONS.md.
   */
  async amend(
    id: string,
    dto: CreateLabResultDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<LabResultResponseDto> {
    const original = await this.getTenantScopedLabResultOrThrow(id, actor);

    if (original.status !== 'VERIFIED') {
      throw new AppException(
        'LAB_RESULT_NOT_VERIFIED',
        'Only a verified result can be amended.',
        HttpStatus.CONFLICT,
      );
    }

    const originalItem = await this.prisma.labOrderItem.findUniqueOrThrow({
      where: { id: original.labOrderItemId },
    });

    const amended = await this.prisma.$transaction(async (tx) => {
      await tx.labResult.update({ where: { id: original.id }, data: { status: 'AMENDED' } });

      const newItem = await tx.labOrderItem.create({
        data: {
          labOrderId: originalItem.labOrderId,
          labTestId: originalItem.labTestId,
          status: 'COLLECTED',
          specimenType: originalItem.specimenType,
          collectedAt: originalItem.collectedAt,
          collectedByUserId: originalItem.collectedByUserId,
        },
      });

      const created = await tx.labResult.create({
        data: {
          hospitalId: original.hospitalId,
          labOrderItemId: newItem.id,
          patientId: original.patientId,
          value: dto.value,
          unit: dto.unit,
          referenceRange: dto.referenceRange,
          flag: dto.flag,
          enteredByUserId: actor.userId,
          amendsId: original.id,
        },
      });

      await tx.labOrderItem.update({ where: { id: newItem.id }, data: { status: 'COMPLETED' } });
      await this.labOrdersService.recomputeOrderStatus(originalItem.labOrderId, tx);

      return created;
    });

    await this.auditService.log({
      action: AuditAction.LAB_RESULT_AMENDED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: original.hospitalId,
      resourceType: 'LabResult',
      resourceId: amended.id,
      correlationId,
      metadata: { amendsId: original.id },
    });

    return this.toResponse(amended);
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<LabResultResponseDto> {
    const result = await this.getTenantScopedLabResultOrThrow(id, actor);
    return this.toResponse(result);
  }

  private async getTenantScopedLabResultOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<LabResult> {
    const result = await this.prisma.labResult.findUnique({ where: { id } });
    if (!result) {
      throw new AppException('LAB_RESULT_NOT_FOUND', 'Lab result not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenantStrict(
      result.hospitalId,
      actor,
      'LAB_RESULT_NOT_FOUND',
      'Lab result not found.',
    );
    return result;
  }

  private toResponse(result: LabResult): LabResultResponseDto {
    return {
      id: result.id,
      hospitalId: result.hospitalId,
      labOrderItemId: result.labOrderItemId,
      patientId: result.patientId,
      value: result.value,
      unit: result.unit,
      referenceRange: result.referenceRange,
      flag: result.flag,
      status: result.status,
      enteredByUserId: result.enteredByUserId,
      enteredAt: result.enteredAt,
      verifiedByUserId: result.verifiedByUserId,
      verifiedAt: result.verifiedAt,
      amendsId: result.amendsId,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }
}
