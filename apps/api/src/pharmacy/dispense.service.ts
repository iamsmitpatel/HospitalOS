import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, DispenseRecord, StockMovementType } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { StockBatchesService } from './stock-batches.service';
import { CreateDispenseDto } from './dto/create-dispense.dto';
import { ReturnStockDto } from './dto/return-stock.dto';
import { DispenseResponseDto } from './dto/dispense-response.dto';
import { StockBatchResponseDto } from './dto/stock-batch-response.dto';

/** Hard ceiling on FEFO batch-allocation attempts within one dispense call — a backstop against a pathological retry storm, not an expected path. */
const MAX_BATCH_ALLOCATION_ATTEMPTS = 50;

@Injectable()
export class DispenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stockBatchesService: StockBatchesService,
  ) {}

  /**
   * FEFO (First-Expired-First-Out) dispensing (master doc §24/§26). A single
   * request may draw from several batches if the earliest-expiring one
   * doesn't have enough on hand — one DispenseRecord + StockMovement per
   * batch actually consumed, all inside one transaction so a mid-way
   * failure never leaves partial stock deducted without a record of where
   * it went.
   */
  async create(
    dto: CreateDispenseDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<DispenseResponseDto[]> {
    const item = await this.prisma.prescriptionItem.findUnique({
      where: { id: dto.prescriptionItemId },
      include: { prescription: true },
    });
    if (!item) {
      throw new AppException(
        'PRESCRIPTION_ITEM_NOT_FOUND',
        'Prescription item not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    assertSameTenantStrict(
      item.prescription.hospitalId,
      actor,
      'PRESCRIPTION_ITEM_NOT_FOUND',
      'Prescription item not found.',
    );
    if (item.prescription.status !== 'FINALIZED') {
      throw new AppException(
        'PRESCRIPTION_NOT_FINALIZED',
        'Only a finalized prescription can be dispensed.',
        HttpStatus.CONFLICT,
      );
    }

    const { _sum } = await this.prisma.dispenseRecord.aggregate({
      where: { prescriptionItemId: item.id },
      _sum: { quantity: true },
    });
    const remaining = item.quantity - (_sum.quantity ?? 0);
    if (dto.quantity > remaining) {
      throw new AppException(
        'EXCEEDS_PRESCRIBED_QUANTITY',
        `Only ${remaining} unit(s) remain undispensed for this item.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const hospitalId = item.prescription.hospitalId;
    const created = await this.prisma.$transaction(async (tx) => {
      let toDispense = dto.quantity;
      const records: DispenseRecord[] = [];

      for (let attempt = 0; toDispense > 0; attempt++) {
        if (attempt >= MAX_BATCH_ALLOCATION_ATTEMPTS) {
          throw new AppException(
            'DISPENSE_ALLOCATION_FAILED',
            'Could not allocate stock for this dispense — please retry.',
            HttpStatus.CONFLICT,
          );
        }

        const candidate = await tx.stockBatch.findFirst({
          where: {
            hospitalId,
            medicineId: item.medicineId,
            status: 'ACTIVE',
            quantityRemaining: { gt: 0 },
            expiryDate: { gte: new Date() },
          },
          orderBy: { expiryDate: 'asc' },
        });
        if (!candidate) {
          throw new AppException(
            'INSUFFICIENT_STOCK',
            'Not enough active, unexpired stock to fulfil this dispense.',
            HttpStatus.CONFLICT,
          );
        }

        const take = Math.min(toDispense, candidate.quantityRemaining);
        const decremented = await tx.stockBatch.updateMany({
          where: { id: candidate.id, quantityRemaining: { gte: take } },
          data: { quantityRemaining: { decrement: take } },
        });
        if (decremented.count === 0) {
          // Lost a race with a concurrent dispense/adjustment against this
          // same batch — retry the whole selection with fresh data.
          continue;
        }

        const freshBatch = await tx.stockBatch.findUniqueOrThrow({ where: { id: candidate.id } });
        if (freshBatch.quantityRemaining === 0) {
          await tx.stockBatch.update({ where: { id: candidate.id }, data: { status: 'DEPLETED' } });
        }

        const record = await tx.dispenseRecord.create({
          data: {
            hospitalId,
            prescriptionItemId: item.id,
            stockBatchId: candidate.id,
            patientId: item.prescription.patientId,
            quantity: take,
            dispensedByUserId: actor.userId,
          },
        });
        await tx.stockMovement.create({
          data: {
            hospitalId,
            medicineId: item.medicineId,
            stockBatchId: candidate.id,
            type: StockMovementType.DISPENSE,
            quantityDelta: -take,
            referenceType: 'DispenseRecord',
            referenceId: record.id,
            createdByUserId: actor.userId,
          },
        });

        records.push(record);
        toDispense -= take;
      }

      return records;
    });

    await this.auditService.log({
      action: AuditAction.MEDICINE_DISPENSED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId,
      resourceType: 'PrescriptionItem',
      resourceId: item.id,
      correlationId,
      metadata: {
        dispenseRecordIds: created.map((r) => r.id),
        totalQuantity: dto.quantity,
        batchesUsed: created.length,
      },
    });

    return created.map((r) => this.toResponse(r));
  }

  /**
   * Credits a quantity back to the batch it was originally dispensed from.
   * Does not track cumulative prior returns against the original dispense
   * (DispenseRecord has no runningReturnedQuantity field) — only checks
   * this single return against the original dispensed amount. See
   * /DECISIONS.md.
   */
  async returnStock(
    dispenseRecordId: string,
    dto: ReturnStockDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<StockBatchResponseDto> {
    const record = await this.prisma.dispenseRecord.findUnique({
      where: { id: dispenseRecordId },
      include: { stockBatch: true },
    });
    if (!record) {
      throw new AppException(
        'DISPENSE_RECORD_NOT_FOUND',
        'Dispense record not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    assertSameTenantStrict(
      record.hospitalId,
      actor,
      'DISPENSE_RECORD_NOT_FOUND',
      'Dispense record not found.',
    );
    if (dto.quantity > record.quantity) {
      throw new AppException(
        'RETURN_EXCEEDS_DISPENSED',
        `Cannot return more than the ${record.quantity} unit(s) originally dispensed.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.$transaction((tx) =>
      this.stockBatchesService.applyMovement(
        tx,
        record.stockBatch,
        StockMovementType.RETURN,
        dto.quantity,
        actor.userId,
        { referenceType: 'DispenseRecord', referenceId: record.id, notes: dto.notes },
      ),
    );

    await this.auditService.log({
      action: AuditAction.STOCK_RETURNED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: record.hospitalId,
      resourceType: 'DispenseRecord',
      resourceId: record.id,
      correlationId,
      metadata: { quantity: dto.quantity },
    });

    return this.stockBatchesService.findOneForTenant(record.stockBatchId, actor);
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<DispenseResponseDto> {
    const record = await this.prisma.dispenseRecord.findUnique({ where: { id } });
    if (!record) {
      throw new AppException(
        'DISPENSE_RECORD_NOT_FOUND',
        'Dispense record not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    assertSameTenantStrict(
      record.hospitalId,
      actor,
      'DISPENSE_RECORD_NOT_FOUND',
      'Dispense record not found.',
    );
    return this.toResponse(record);
  }

  async listForPrescriptionItem(
    prescriptionItemId: string,
    actor: AuthenticatedUser,
  ): Promise<DispenseResponseDto[]> {
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }
    const records = await this.prisma.dispenseRecord.findMany({
      where: { prescriptionItemId, hospitalId: actor.hospitalId },
      orderBy: { dispensedAt: 'desc' },
    });
    return records.map((r) => this.toResponse(r));
  }

  private toResponse(record: DispenseRecord): DispenseResponseDto {
    return {
      id: record.id,
      hospitalId: record.hospitalId,
      prescriptionItemId: record.prescriptionItemId,
      stockBatchId: record.stockBatchId,
      patientId: record.patientId,
      quantity: record.quantity,
      dispensedByUserId: record.dispensedByUserId,
      dispensedAt: record.dispensedAt,
    };
  }
}
