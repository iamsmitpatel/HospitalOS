import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Payment, Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { InvoicesService } from '../billing/invoices.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly invoicesService: InvoicesService,
  ) {}

  /**
   * Idempotent create (master doc §47): when idempotencyKey is supplied, a
   * retried request with the same key returns the original payment instead
   * of creating a second one and double-crediting the invoice. Checked
   * up front AND backstopped by the DB unique constraint for the
   * concurrent-retry race — same two-layer pattern as the appointment-slot
   * and encounter-appointment uniqueness checks elsewhere in this codebase.
   */
  async create(
    dto: CreatePaymentDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<PaymentResponseDto> {
    const invoice = await this.invoicesService.getTenantScopedInvoiceOrThrow(dto.invoiceId, actor);

    if (dto.idempotencyKey) {
      const existing = await this.prisma.payment.findUnique({
        where: {
          hospitalId_idempotencyKey: {
            hospitalId: invoice.hospitalId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });
      if (existing) {
        return this.toResponse(existing);
      }
    }

    let payment: Payment;
    try {
      payment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            hospitalId: invoice.hospitalId,
            invoiceId: invoice.id,
            amount: dto.amount,
            method: dto.method,
            referenceNumber: dto.referenceNumber,
            idempotencyKey: dto.idempotencyKey,
            createdByUserId: actor.userId,
          },
        });
        await this.invoicesService.applyPayment(tx, invoice, new Prisma.Decimal(dto.amount));
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.payment.findUniqueOrThrow({
          where: {
            hospitalId_idempotencyKey: {
              hospitalId: invoice.hospitalId,
              idempotencyKey: dto.idempotencyKey!,
            },
          },
        });
        return this.toResponse(existing);
      }
      throw error;
    }

    await this.auditService.log({
      action: AuditAction.PAYMENT_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: invoice.hospitalId,
      resourceType: 'Payment',
      resourceId: payment.id,
      correlationId,
      metadata: { invoiceId: invoice.id, amount: dto.amount },
    });

    return this.toResponse(payment);
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<PaymentResponseDto> {
    const payment = await this.getTenantScopedPaymentOrThrow(id, actor);
    return this.toResponse(payment);
  }

  async listForInvoice(invoiceId: string, actor: AuthenticatedUser): Promise<PaymentResponseDto[]> {
    await this.invoicesService.getTenantScopedInvoiceOrThrow(invoiceId, actor);
    const payments = await this.prisma.payment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
    });
    return payments.map((p) => this.toResponse(p));
  }

  /** Used by refunds.service.ts to validate a paymentId reference. */
  async getTenantScopedPaymentOrThrow(id: string, actor: AuthenticatedUser): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new AppException('PAYMENT_NOT_FOUND', 'Payment not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenantStrict(payment.hospitalId, actor, 'PAYMENT_NOT_FOUND', 'Payment not found.');
    return payment;
  }

  private toResponse(payment: Payment): PaymentResponseDto {
    return {
      id: payment.id,
      hospitalId: payment.hospitalId,
      invoiceId: payment.invoiceId,
      amount: payment.amount.toString(),
      method: payment.method,
      status: payment.status,
      referenceNumber: payment.referenceNumber,
      idempotencyKey: payment.idempotencyKey,
      createdByUserId: payment.createdByUserId,
      createdAt: payment.createdAt,
    };
  }
}
