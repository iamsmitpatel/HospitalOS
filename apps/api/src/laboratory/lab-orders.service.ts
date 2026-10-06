import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AuditOutcome,
  LabOrder,
  LabOrderItem,
  LabOrderItemStatus,
  LabOrderStatus,
  LabResult,
} from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { EncountersService, assertEncounterNotCancelled } from '../clinical/encounters.service';
import { LabTestsService } from './lab-tests.service';
import { CreateLabOrderDto } from './dto/create-lab-order.dto';
import { CollectSpecimenDto } from './dto/collect-specimen.dto';
import { LabOrderResponseDto } from './dto/lab-order-response.dto';

type LabOrderItemWithOrderAndResult = LabOrderItem & {
  labOrder: LabOrder;
  result: LabResult | null;
};
type LabOrderWithItems = LabOrder & { items: (LabOrderItem & { result: LabResult | null })[] };

/**
 * Pure rollup from item statuses to the order's overall status — every
 * LabOrderStatus value is reachable and meaningful (master doc §29):
 * ORDERED (nothing collected yet) -> COLLECTED (all specimens in, no
 * results yet) -> PROCESSING (at least one result entered, not all) ->
 * COMPLETED (every non-cancelled item has a result). Cancellation is only
 * ever explicit (see cancel() below), never derived — except when every
 * item has itself been cancelled.
 */
export function computeLabOrderStatus(itemStatuses: LabOrderItemStatus[]): LabOrderStatus {
  const active = itemStatuses.filter((s) => s !== 'CANCELLED');
  if (active.length === 0) {
    return 'CANCELLED';
  }
  if (active.every((s) => s === 'COMPLETED')) {
    return 'COMPLETED';
  }
  if (active.some((s) => s === 'COMPLETED')) {
    return 'PROCESSING';
  }
  if (active.every((s) => s === 'COLLECTED')) {
    return 'COLLECTED';
  }
  return 'ORDERED';
}

@Injectable()
export class LabOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly encountersService: EncountersService,
    private readonly labTestsService: LabTestsService,
  ) {}

  async create(
    encounterId: string,
    dto: CreateLabOrderDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<LabOrderResponseDto> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    assertEncounterNotCancelled(encounter);
    await this.encountersService.assertOwnEncounter(encounter, actor);

    const labTestIds = [...new Set(dto.items.map((item) => item.labTestId))];
    for (const labTestId of labTestIds) {
      const labTest = await this.labTestsService.getTenantScopedLabTestOrThrow(labTestId, actor);
      if (!labTest.isActive) {
        throw new AppException(
          'LAB_TEST_INACTIVE',
          `Lab test ${labTest.name} is inactive and cannot be ordered.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const order = await this.prisma.labOrder.create({
      data: {
        hospitalId: encounter.hospitalId,
        encounterId: encounter.id,
        patientId: encounter.patientId,
        doctorProfileId: encounter.doctorProfileId,
        items: { create: dto.items.map((item) => ({ labTestId: item.labTestId })) },
      },
      include: { items: { include: { result: true } } },
    });

    await this.auditService.log({
      action: AuditAction.LAB_ORDER_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'LabOrder',
      resourceId: order.id,
      correlationId,
    });

    return this.toResponse(order);
  }

  async listForEncounter(
    encounterId: string,
    actor: AuthenticatedUser,
  ): Promise<LabOrderResponseDto[]> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    const orders = await this.prisma.labOrder.findMany({
      where: { encounterId: encounter.id },
      include: { items: { include: { result: true } } },
      orderBy: { orderedAt: 'desc' },
    });
    return orders.map((o) => this.toResponse(o));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<LabOrderResponseDto> {
    const order = await this.getTenantScopedLabOrderOrThrow(id, actor);
    return this.toResponse(order);
  }

  async cancel(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<LabOrderResponseDto> {
    const order = await this.getTenantScopedLabOrderOrThrow(id, actor);
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      order.encounterId,
      actor,
    );
    await this.encountersService.assertOwnEncounter(encounter, actor);

    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new AppException(
        'LAB_ORDER_NOT_CANCELLABLE',
        `Cannot cancel a lab order in status ${order.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.labOrderItem.updateMany({
        where: { labOrderId: order.id, status: { in: ['ORDERED', 'COLLECTED'] } },
        data: { status: 'CANCELLED' },
      });
      return tx.labOrder.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
        include: { items: { include: { result: true } } },
      });
    });

    await this.auditService.log({
      action: AuditAction.LAB_ORDER_CANCELLED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'LabOrder',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  async collectSpecimen(
    itemId: string,
    dto: CollectSpecimenDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<LabOrderResponseDto> {
    const item = await this.getTenantScopedLabOrderItemOrThrow(itemId, actor);

    if (item.status !== 'ORDERED') {
      throw new AppException(
        'LAB_ORDER_ITEM_NOT_ORDERED',
        `Cannot collect a specimen for an item in status ${item.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      await tx.labOrderItem.update({
        where: { id: item.id },
        data: {
          status: 'COLLECTED',
          specimenType: dto.specimenType,
          collectedAt: new Date(),
          collectedByUserId: actor.userId,
        },
      });
      return this.recomputeOrderStatus(item.labOrderId, tx);
    });

    await this.auditService.log({
      action: AuditAction.SPECIMEN_COLLECTED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: item.labOrder.hospitalId,
      resourceType: 'LabOrderItem',
      resourceId: item.id,
      correlationId,
    });

    return this.toResponse(updatedOrder);
  }

  /** Used by lab-results.service.ts to validate an item reference before entering a result. */
  async getTenantScopedLabOrderItemOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<LabOrderItemWithOrderAndResult> {
    const item = await this.prisma.labOrderItem.findUnique({
      where: { id },
      include: { labOrder: true, result: true },
    });
    if (!item) {
      throw new AppException(
        'LAB_ORDER_ITEM_NOT_FOUND',
        'Lab order item not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    assertSameTenantStrict(
      item.labOrder.hospitalId,
      actor,
      'LAB_ORDER_ITEM_NOT_FOUND',
      'Lab order item not found.',
    );
    return item;
  }

  /**
   * Recomputes and persists the order's rollup status from its items — used
   * both after specimen collection here and after result entry in
   * lab-results.service.ts (passed the same transaction client so both
   * writes commit atomically).
   */
  async recomputeOrderStatus(
    labOrderId: string,
    tx: Pick<PrismaService, 'labOrderItem' | 'labOrder'>,
  ): Promise<LabOrderWithItems> {
    const items = await tx.labOrderItem.findMany({ where: { labOrderId } });
    const status = computeLabOrderStatus(items.map((i) => i.status));
    return tx.labOrder.update({
      where: { id: labOrderId },
      data: { status },
      include: { items: { include: { result: true } } },
    });
  }

  private async getTenantScopedLabOrderOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<LabOrderWithItems> {
    const order = await this.prisma.labOrder.findUnique({
      where: { id },
      include: { items: { include: { result: true } } },
    });
    if (!order) {
      throw new AppException('LAB_ORDER_NOT_FOUND', 'Lab order not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenantStrict(order.hospitalId, actor, 'LAB_ORDER_NOT_FOUND', 'Lab order not found.');
    return order;
  }

  private toResponse(order: LabOrderWithItems): LabOrderResponseDto {
    return {
      id: order.id,
      hospitalId: order.hospitalId,
      encounterId: order.encounterId,
      patientId: order.patientId,
      doctorProfileId: order.doctorProfileId,
      status: order.status,
      orderedAt: order.orderedAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: order.items.map((item) => ({
        id: item.id,
        labTestId: item.labTestId,
        status: item.status,
        specimenType: item.specimenType,
        collectedAt: item.collectedAt,
        collectedByUserId: item.collectedByUserId,
        result: item.result
          ? {
              id: item.result.id,
              value: item.result.value,
              unit: item.result.unit,
              referenceRange: item.result.referenceRange,
              flag: item.result.flag,
              status: item.result.status,
              enteredByUserId: item.result.enteredByUserId,
              enteredAt: item.result.enteredAt,
              verifiedByUserId: item.result.verifiedByUserId,
              verifiedAt: item.result.verifiedAt,
              amendsId: item.result.amendsId,
            }
          : null,
      })),
    };
  }
}
