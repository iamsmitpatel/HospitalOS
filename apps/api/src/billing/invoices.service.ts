import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Invoice, InvoiceItem, Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { ServicesService } from './services.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceItemDto } from './dto/invoice-item.dto';
import { InvoiceQueryDto } from './dto/invoice-query.dto';
import { InvoiceResponseDto, PaginatedInvoicesResponseDto } from './dto/invoice-response.dto';

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };
type PrismaTx = Pick<PrismaService, 'invoice'>;

interface InvoiceLineItemData {
  serviceId?: string;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

const INVOICE_SEQUENCE_PAD_LENGTH = 6;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly servicesService: ServicesService,
  ) {}

  async create(
    dto: CreateInvoiceDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<InvoiceResponseDto> {
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }

    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId } });
    if (!patient || patient.hospitalId !== actor.hospitalId) {
      throw new AppException('PATIENT_NOT_FOUND', 'Patient not found.', HttpStatus.NOT_FOUND);
    }

    if (dto.encounterId) {
      const encounter = await this.prisma.encounter.findUnique({
        where: { id: dto.encounterId },
      });
      if (
        !encounter ||
        encounter.hospitalId !== actor.hospitalId ||
        encounter.patientId !== patient.id
      ) {
        throw new AppException(
          'ENCOUNTER_NOT_FOUND',
          'Encounter not found for this patient.',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const itemsData = await Promise.all(dto.items.map((item) => this.buildItemData(item, actor)));
    const subtotal = itemsData.reduce(
      (sum, item) => sum.add(item.lineTotal),
      new Prisma.Decimal(0),
    );
    const invoiceDiscount = new Prisma.Decimal(dto.discountAmount ?? 0);
    const taxableAmount = subtotal.sub(invoiceDiscount);
    if (taxableAmount.isNegative()) {
      throw new AppException(
        'DISCOUNT_EXCEEDS_SUBTOTAL',
        'The invoice-level discount cannot exceed the subtotal.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const taxRate = new Prisma.Decimal(dto.taxRate ?? 0);
    const taxAmount = taxableAmount.mul(taxRate);
    const total = taxableAmount.add(taxAmount);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const hospital = await tx.hospital.update({
        where: { id: actor.hospitalId! },
        data: { invoiceSequence: { increment: 1 } },
      });
      const invoiceNumber = `${hospital.code}-INV-${String(hospital.invoiceSequence).padStart(
        INVOICE_SEQUENCE_PAD_LENGTH,
        '0',
      )}`;

      return tx.invoice.create({
        data: {
          hospitalId: actor.hospitalId!,
          patientId: patient.id,
          encounterId: dto.encounterId,
          invoiceNumber,
          subtotal,
          discountAmount: invoiceDiscount,
          taxRate,
          taxAmount,
          total,
          createdByUserId: actor.userId,
          items: { create: itemsData },
        },
        include: { items: true },
      });
    });

    await this.auditService.log({
      action: AuditAction.INVOICE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: actor.hospitalId,
      resourceType: 'Invoice',
      resourceId: invoice.id,
      correlationId,
    });

    return this.toResponse(invoice);
  }

  async findAllForTenant(
    actor: AuthenticatedUser,
    query: InvoiceQueryDto,
  ): Promise<PaginatedInvoicesResponseDto> {
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }

    const where = {
      hospitalId: actor.hospitalId,
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items: items.map((i) => this.toResponse(i)), total, page, pageSize };
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<InvoiceResponseDto> {
    const invoice = await this.getTenantScopedInvoiceOrThrow(id, actor);
    return this.toResponse(invoice);
  }

  async issue(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<InvoiceResponseDto> {
    const invoice = await this.getTenantScopedInvoiceOrThrow(id, actor);
    if (invoice.status !== 'DRAFT') {
      throw new AppException(
        'INVOICE_NOT_DRAFT',
        `Cannot issue an invoice in status ${invoice.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'ISSUED', issuedAt: new Date() },
      include: { items: true },
    });

    await this.auditService.log({
      action: AuditAction.INVOICE_ISSUED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'Invoice',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  async cancel(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<InvoiceResponseDto> {
    const invoice = await this.getTenantScopedInvoiceOrThrow(id, actor);
    if (invoice.status !== 'DRAFT' && invoice.status !== 'ISSUED') {
      throw new AppException(
        'INVOICE_NOT_CANCELLABLE',
        `Cannot cancel an invoice in status ${invoice.status}.`,
        HttpStatus.CONFLICT,
      );
    }
    if (invoice.amountPaid.greaterThan(0)) {
      throw new AppException(
        'INVOICE_HAS_PAYMENTS',
        'Cannot cancel an invoice that already has payments recorded.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'CANCELLED' },
      include: { items: true },
    });

    await this.auditService.log({
      action: AuditAction.INVOICE_CANCELLED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'Invoice',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  /** Used by payments.service.ts / refunds.service.ts to validate an invoice reference. */
  async getTenantScopedInvoiceOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<InvoiceWithItems> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!invoice) {
      throw new AppException('INVOICE_NOT_FOUND', 'Invoice not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenantStrict(invoice.hospitalId, actor, 'INVOICE_NOT_FOUND', 'Invoice not found.');
    return invoice;
  }

  /** Applies a successful payment to the invoice's running balance — called inside payments.service.ts's own transaction. */
  async applyPayment(tx: PrismaTx, invoice: Invoice, amount: Prisma.Decimal): Promise<Invoice> {
    if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
      throw new AppException(
        'INVOICE_NOT_PAYABLE',
        `Cannot record a payment against an invoice in status ${invoice.status}.`,
        HttpStatus.CONFLICT,
      );
    }
    const newAmountPaid = invoice.amountPaid.add(amount);
    if (newAmountPaid.greaterThan(invoice.total)) {
      throw new AppException(
        'PAYMENT_EXCEEDS_BALANCE',
        'This payment would exceed the invoice total.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const status = newAmountPaid.equals(invoice.total) ? 'PAID' : 'PARTIALLY_PAID';
    return tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: newAmountPaid, status },
    });
  }

  /** Applies a refund to the invoice's running balance — called inside refunds.service.ts's own transaction. */
  async applyRefund(tx: PrismaTx, invoice: Invoice, amount: Prisma.Decimal): Promise<Invoice> {
    const newAmountRefunded = invoice.amountRefunded.add(amount);
    if (newAmountRefunded.greaterThan(invoice.amountPaid)) {
      throw new AppException(
        'REFUND_EXCEEDS_PAID',
        'Cannot refund more than has been paid on this invoice.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const netPaid = invoice.amountPaid.sub(newAmountRefunded);
    const status = netPaid.lessThanOrEqualTo(0)
      ? 'REFUNDED'
      : netPaid.lessThan(invoice.total)
        ? 'PARTIALLY_PAID'
        : 'PAID';
    return tx.invoice.update({
      where: { id: invoice.id },
      data: { amountRefunded: newAmountRefunded, status },
    });
  }

  private async buildItemData(
    item: InvoiceItemDto,
    actor: AuthenticatedUser,
  ): Promise<InvoiceLineItemData> {
    let description: string;
    let unitPrice: Prisma.Decimal;

    if (item.serviceId) {
      const service = await this.servicesService.getTenantScopedServiceOrThrow(
        item.serviceId,
        actor,
      );
      if (!service.isActive) {
        throw new AppException(
          'SERVICE_INACTIVE',
          `Service ${service.name} is inactive and cannot be billed.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      const currentPrice = await this.servicesService.getCurrentPrice(service.id);
      if (!currentPrice) {
        throw new AppException(
          'SERVICE_PRICE_NOT_SET',
          `Service ${service.name} has no current price set.`,
          HttpStatus.CONFLICT,
        );
      }
      description = item.description ?? service.name;
      unitPrice = currentPrice.amount;
    } else {
      if (!item.description || item.unitPrice === undefined) {
        throw new AppException(
          'FREEFORM_ITEM_INCOMPLETE',
          'A line item without serviceId must supply both description and unitPrice.',
          HttpStatus.BAD_REQUEST,
        );
      }
      description = item.description;
      unitPrice = new Prisma.Decimal(item.unitPrice);
    }

    const quantity = item.quantity ?? 1;
    const discountAmount = new Prisma.Decimal(item.discountAmount ?? 0);
    const lineTotal = unitPrice.mul(quantity).sub(discountAmount);
    if (lineTotal.isNegative()) {
      throw new AppException(
        'ITEM_DISCOUNT_EXCEEDS_LINE_TOTAL',
        `The discount on "${description}" cannot exceed its line total.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      serviceId: item.serviceId,
      description,
      quantity,
      unitPrice,
      discountAmount,
      lineTotal,
    };
  }

  private toResponse(invoice: InvoiceWithItems): InvoiceResponseDto {
    return {
      id: invoice.id,
      hospitalId: invoice.hospitalId,
      patientId: invoice.patientId,
      encounterId: invoice.encounterId,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      subtotal: invoice.subtotal.toString(),
      discountAmount: invoice.discountAmount.toString(),
      taxRate: invoice.taxRate.toString(),
      taxAmount: invoice.taxAmount.toString(),
      total: invoice.total.toString(),
      amountPaid: invoice.amountPaid.toString(),
      amountRefunded: invoice.amountRefunded.toString(),
      currency: invoice.currency,
      issuedAt: invoice.issuedAt,
      createdByUserId: invoice.createdByUserId,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      items: invoice.items.map((item) => ({
        id: item.id,
        serviceId: item.serviceId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        discountAmount: item.discountAmount.toString(),
        lineTotal: item.lineTotal.toString(),
      })),
    };
  }
}
