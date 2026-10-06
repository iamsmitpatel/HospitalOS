import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Role, Service, ServicePrice } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenant, resolveTenantHospitalId } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { SetServicePriceDto } from './dto/set-service-price.dto';
import { ServiceResponseDto } from './dto/service-response.dto';
import { ServicePriceResponseDto } from './dto/service-price-response.dto';

/** Catalog data, same tenant-resolution rule as LabTestsService/MedicinesService — see there for the rationale. */
@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateServiceDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<ServiceResponseDto> {
    const hospitalId = await resolveTenantHospitalId(this.prisma, actor, undefined);

    const existing = await this.prisma.service.findUnique({
      where: { hospitalId_code: { hospitalId, code: dto.code } },
    });
    if (existing) {
      throw new AppException(
        'SERVICE_CODE_TAKEN',
        'A service with this code already exists in this hospital.',
        HttpStatus.CONFLICT,
      );
    }

    const service = await this.prisma.service.create({
      data: { hospitalId, name: dto.name, code: dto.code, category: dto.category },
    });

    await this.auditService.log({
      action: AuditAction.SERVICE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId,
      resourceType: 'Service',
      resourceId: service.id,
      correlationId,
    });

    return this.toResponse(service, null);
  }

  async findAllForTenant(
    actor: AuthenticatedUser,
    isActive?: boolean,
  ): Promise<ServiceResponseDto[]> {
    const where =
      actor.role === Role.SUPER_ADMIN
        ? isActive === undefined
          ? {}
          : { isActive }
        : (() => {
            if (!actor.hospitalId) {
              throw new AppException(
                'TENANT_CONTEXT_MISSING',
                'Caller has no associated hospital.',
                HttpStatus.FORBIDDEN,
              );
            }
            return {
              hospitalId: actor.hospitalId,
              ...(isActive === undefined ? {} : { isActive }),
            };
          })();

    const services = await this.prisma.service.findMany({
      where,
      include: { prices: { where: { effectiveTo: null } } },
      orderBy: { name: 'asc' },
    });
    return services.map((s) => this.toResponse(s, s.prices[0] ?? null));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<ServiceResponseDto> {
    const service = await this.getTenantScopedServiceOrThrow(id, actor);
    const currentPrice = await this.getCurrentPrice(service.id);
    return this.toResponse(service, currentPrice);
  }

  async update(
    id: string,
    dto: UpdateServiceDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<ServiceResponseDto> {
    const service = await this.getTenantScopedServiceOrThrow(id, actor);

    const updated = await this.prisma.service.update({
      where: { id: service.id },
      data: { name: dto.name, category: dto.category, isActive: dto.isActive },
    });

    await this.auditService.log({
      action: AuditAction.SERVICE_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'Service',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    const currentPrice = await this.getCurrentPrice(updated.id);
    return this.toResponse(updated, currentPrice);
  }

  /**
   * Closes out the current price (effectiveTo: null -> now) and opens a new
   * one in the same transaction (master doc §37/§38) — never mutates an
   * existing ServicePrice row, so InvoiceItems already billed against the
   * old price are unaffected.
   */
  async setPrice(
    serviceId: string,
    dto: SetServicePriceDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<ServicePriceResponseDto> {
    const service = await this.getTenantScopedServiceOrThrow(serviceId, actor);

    const price = await this.prisma.$transaction(async (tx) => {
      await tx.servicePrice.updateMany({
        where: { serviceId: service.id, effectiveTo: null },
        data: { effectiveTo: new Date() },
      });
      return tx.servicePrice.create({
        data: {
          hospitalId: service.hospitalId,
          serviceId: service.id,
          amount: dto.amount,
          currency: dto.currency ?? 'INR',
        },
      });
    });

    await this.auditService.log({
      action: AuditAction.SERVICE_PRICE_SET,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: service.hospitalId,
      resourceType: 'Service',
      resourceId: service.id,
      correlationId,
      metadata: { amount: dto.amount, currency: dto.currency ?? 'INR' },
    });

    return this.toPriceResponse(price);
  }

  async listPriceHistory(
    serviceId: string,
    actor: AuthenticatedUser,
  ): Promise<ServicePriceResponseDto[]> {
    const service = await this.getTenantScopedServiceOrThrow(serviceId, actor);
    const prices = await this.prisma.servicePrice.findMany({
      where: { serviceId: service.id },
      orderBy: { effectiveFrom: 'desc' },
    });
    return prices.map((p) => this.toPriceResponse(p));
  }

  /** Used by invoices.service.ts to snapshot the current price onto a new InvoiceItem. */
  async getCurrentPrice(serviceId: string): Promise<ServicePrice | null> {
    return this.prisma.servicePrice.findFirst({ where: { serviceId, effectiveTo: null } });
  }

  /** Used by invoices.service.ts to validate a serviceId reference. */
  async getTenantScopedServiceOrThrow(id: string, actor: AuthenticatedUser): Promise<Service> {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) {
      throw new AppException('SERVICE_NOT_FOUND', 'Service not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenant(service.hospitalId, actor, 'SERVICE_NOT_FOUND', 'Service not found.');
    return service;
  }

  private toResponse(service: Service, currentPrice: ServicePrice | null): ServiceResponseDto {
    return {
      id: service.id,
      hospitalId: service.hospitalId,
      name: service.name,
      code: service.code,
      category: service.category,
      isActive: service.isActive,
      currentPrice: currentPrice ? currentPrice.amount.toString() : null,
      createdAt: service.createdAt,
    };
  }

  private toPriceResponse(price: ServicePrice): ServicePriceResponseDto {
    return {
      id: price.id,
      serviceId: price.serviceId,
      amount: price.amount.toString(),
      currency: price.currency,
      effectiveFrom: price.effectiveFrom,
      effectiveTo: price.effectiveTo,
    };
  }
}
