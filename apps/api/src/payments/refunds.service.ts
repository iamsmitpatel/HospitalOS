import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Prisma, Refund } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { InvoicesService } from '../billing/invoices.service';
import { PaymentsService } from './payments.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { RefundResponseDto } from './dto/refund-response.dto';

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async create(
    dto: CreateRefundDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<RefundResponseDto> {
    const invoice = await this.invoicesService.getTenantScopedInvoiceOrThrow(dto.invoiceId, actor);

    if (dto.paymentId) {
      const payment = await this.paymentsService.getTenantScopedPaymentOrThrow(
        dto.paymentId,
        actor,
      );
      if (payment.invoiceId !== invoice.id) {
        throw new AppException(
          'PAYMENT_NOT_FOUND',
          'This payment does not belong to the given invoice.',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const refund = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          hospitalId: invoice.hospitalId,
          invoiceId: invoice.id,
          paymentId: dto.paymentId,
          amount: dto.amount,
          reason: dto.reason,
          createdByUserId: actor.userId,
        },
      });
      await this.invoicesService.applyRefund(tx, invoice, new Prisma.Decimal(dto.amount));
      return created;
    });

    await this.auditService.log({
      action: AuditAction.REFUND_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: invoice.hospitalId,
      resourceType: 'Refund',
      resourceId: refund.id,
      correlationId,
      metadata: { invoiceId: invoice.id, paymentId: dto.paymentId, amount: dto.amount },
    });

    return this.toResponse(refund);
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<RefundResponseDto> {
    const refund = await this.getTenantScopedRefundOrThrow(id, actor);
    return this.toResponse(refund);
  }

  async listForInvoice(invoiceId: string, actor: AuthenticatedUser): Promise<RefundResponseDto[]> {
    await this.invoicesService.getTenantScopedInvoiceOrThrow(invoiceId, actor);
    const refunds = await this.prisma.refund.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
    });
    return refunds.map((r) => this.toResponse(r));
  }

  private async getTenantScopedRefundOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Refund> {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) {
      throw new AppException('REFUND_NOT_FOUND', 'Refund not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenantStrict(refund.hospitalId, actor, 'REFUND_NOT_FOUND', 'Refund not found.');
    return refund;
  }

  private toResponse(refund: Refund): RefundResponseDto {
    return {
      id: refund.id,
      hospitalId: refund.hospitalId,
      invoiceId: refund.invoiceId,
      paymentId: refund.paymentId,
      amount: refund.amount.toString(),
      reason: refund.reason,
      status: refund.status,
      createdByUserId: refund.createdByUserId,
      createdAt: refund.createdAt,
    };
  }
}
