import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Prisma, StockBatch, StockMovementType } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { MedicinesService } from './medicines.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StockBatchResponseDto } from './dto/stock-batch-response.dto';
import { StockMovementResponseDto } from './dto/stock-movement-response.dto';

type PrismaTx = Pick<PrismaService, 'stockBatch' | 'stockMovement'>;

@Injectable()
export class StockBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly medicinesService: MedicinesService,
  ) {}

  async receiveStock(
    medicineId: string,
    dto: ReceiveStockDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<StockBatchResponseDto> {
    const medicine = await this.medicinesService.getTenantScopedMedicineOrThrow(medicineId, actor);
    if (!medicine.isActive) {
      throw new AppException(
        'MEDICINE_INACTIVE',
        'Cannot receive stock for an inactive medicine.',
        HttpStatus.BAD_REQUEST,
      );
    }

    let batch: StockBatch;
    try {
      batch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.stockBatch.create({
          data: {
            hospitalId: medicine.hospitalId,
            medicineId: medicine.id,
            batchNumber: dto.batchNumber,
            quantityReceived: dto.quantityReceived,
            quantityRemaining: dto.quantityReceived,
            expiryDate: new Date(dto.expiryDate),
            purchasePrice: dto.purchasePrice,
            createdByUserId: actor.userId,
          },
        });
        await tx.stockMovement.create({
          data: {
            hospitalId: medicine.hospitalId,
            medicineId: medicine.id,
            stockBatchId: created.id,
            type: StockMovementType.PURCHASE,
            quantityDelta: dto.quantityReceived,
            referenceType: 'StockBatch',
            referenceId: created.id,
            createdByUserId: actor.userId,
          },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          'BATCH_NUMBER_TAKEN',
          'A batch with this number already exists for this medicine.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.auditService.log({
      action: AuditAction.STOCK_RECEIVED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: medicine.hospitalId,
      resourceType: 'StockBatch',
      resourceId: batch.id,
      correlationId,
    });

    return this.toResponse(batch);
  }

  async adjust(
    id: string,
    dto: AdjustStockDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<StockBatchResponseDto> {
    const batch = await this.getTenantScopedStockBatchOrThrow(id, actor);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.applyMovement(
        tx,
        batch,
        StockMovementType.ADJUSTMENT,
        dto.delta,
        actor.userId,
        { notes: dto.notes },
      );
      return result;
    });

    await this.auditService.log({
      action: AuditAction.STOCK_ADJUSTED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'StockBatch',
      resourceId: updated.id,
      correlationId,
      metadata: { delta: dto.delta, notes: dto.notes },
    });

    return this.toResponse(updated);
  }

  async markExpired(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<StockBatchResponseDto> {
    const batch = await this.getTenantScopedStockBatchOrThrow(id, actor);

    if (batch.status !== 'ACTIVE') {
      throw new AppException(
        'STOCK_BATCH_NOT_ACTIVE',
        `Cannot mark a batch in status ${batch.status} as expired.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.applyMovement(
        tx,
        batch,
        StockMovementType.EXPIRED,
        -batch.quantityRemaining,
        actor.userId,
        { referenceType: 'StockBatch', referenceId: batch.id },
      );
      return tx.stockBatch.update({ where: { id: batch.id }, data: { status: 'EXPIRED' } });
    });

    await this.auditService.log({
      action: AuditAction.STOCK_EXPIRED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'StockBatch',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  async listForMedicine(
    medicineId: string,
    actor: AuthenticatedUser,
  ): Promise<StockBatchResponseDto[]> {
    const medicine = await this.medicinesService.getTenantScopedMedicineOrThrow(medicineId, actor);
    const batches = await this.prisma.stockBatch.findMany({
      where: { medicineId: medicine.id },
      orderBy: { expiryDate: 'asc' },
    });
    return batches.map((b) => this.toResponse(b));
  }

  async listMovementsForMedicine(
    medicineId: string,
    actor: AuthenticatedUser,
  ): Promise<StockMovementResponseDto[]> {
    const medicine = await this.medicinesService.getTenantScopedMedicineOrThrow(medicineId, actor);
    const movements = await this.prisma.stockMovement.findMany({
      where: { medicineId: medicine.id },
      orderBy: { createdAt: 'desc' },
    });
    return movements.map((m) => ({
      id: m.id,
      medicineId: m.medicineId,
      stockBatchId: m.stockBatchId,
      type: m.type,
      quantityDelta: m.quantityDelta,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      notes: m.notes,
      createdByUserId: m.createdByUserId,
      createdAt: m.createdAt,
    }));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<StockBatchResponseDto> {
    const batch = await this.getTenantScopedStockBatchOrThrow(id, actor);
    return this.toResponse(batch);
  }

  /** Used by dispense.service.ts to validate/credit a specific batch (e.g. a return) within its own transaction. */
  async getTenantScopedStockBatchOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<StockBatch> {
    const batch = await this.prisma.stockBatch.findUnique({ where: { id } });
    if (!batch) {
      throw new AppException(
        'STOCK_BATCH_NOT_FOUND',
        'Stock batch not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    assertSameTenantStrict(
      batch.hospitalId,
      actor,
      'STOCK_BATCH_NOT_FOUND',
      'Stock batch not found.',
    );
    return batch;
  }

  /**
   * Shared increment/decrement + movement-logging primitive (master doc
   * §23-§25): a negative delta is applied via a conditional UPDATE
   * (quantityRemaining >= -delta) so it can never drive stock below zero
   * even under concurrent writers — the same atomic-decrement pattern as
   * dispense.service.ts, just generalized to any signed delta. DEPLETED/
   * ACTIVE status is recomputed from the resulting quantity; an EXPIRED
   * batch's status is never touched here (callers that need it stay
   * EXPIRED update it explicitly afterward, as markExpired does above).
   */
  async applyMovement(
    tx: PrismaTx,
    batch: StockBatch,
    type: StockMovementType,
    delta: number,
    actorUserId: string,
    meta: { referenceType?: string; referenceId?: string; notes?: string } = {},
  ): Promise<StockBatch> {
    let updated: StockBatch;
    if (delta < 0) {
      const result = await tx.stockBatch.updateMany({
        where: { id: batch.id, quantityRemaining: { gte: -delta } },
        data: { quantityRemaining: { increment: delta } },
      });
      if (result.count === 0) {
        throw new AppException(
          'INSUFFICIENT_STOCK',
          'This adjustment would make the batch quantity negative.',
          HttpStatus.BAD_REQUEST,
        );
      }
      updated = await tx.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    } else {
      updated = await tx.stockBatch.update({
        where: { id: batch.id },
        data: { quantityRemaining: { increment: delta } },
      });
    }

    if (updated.status !== 'EXPIRED') {
      const nextStatus = updated.quantityRemaining === 0 ? 'DEPLETED' : 'ACTIVE';
      if (nextStatus !== updated.status) {
        updated = await tx.stockBatch.update({
          where: { id: batch.id },
          data: { status: nextStatus },
        });
      }
    }

    await tx.stockMovement.create({
      data: {
        hospitalId: batch.hospitalId,
        medicineId: batch.medicineId,
        stockBatchId: batch.id,
        type,
        quantityDelta: delta,
        referenceType: meta.referenceType,
        referenceId: meta.referenceId,
        notes: meta.notes,
        createdByUserId: actorUserId,
      },
    });

    return updated;
  }

  private toResponse(batch: StockBatch): StockBatchResponseDto {
    return {
      id: batch.id,
      hospitalId: batch.hospitalId,
      medicineId: batch.medicineId,
      batchNumber: batch.batchNumber,
      quantityReceived: batch.quantityReceived,
      quantityRemaining: batch.quantityRemaining,
      expiryDate: batch.expiryDate,
      purchasePrice: batch.purchasePrice?.toString() ?? null,
      status: batch.status,
      receivedAt: batch.receivedAt,
      createdByUserId: batch.createdByUserId,
    };
  }
}
