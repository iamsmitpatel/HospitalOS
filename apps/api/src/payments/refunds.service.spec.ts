import { Prisma, Role } from '@prisma/client';
import { RefundsService } from './refunds.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('RefundsService', () => {
  let prisma: any;
  let auditService: any;
  let invoicesService: any;
  let paymentsService: any;
  let service: RefundsService;

  const actor: AuthenticatedUser = {
    userId: 'accountant-1',
    email: 'accountant@hospitalos.dev',
    role: Role.ACCOUNTANT,
    hospitalId: 'hospital-a',
  };

  const paidInvoice = {
    id: 'invoice-1',
    hospitalId: 'hospital-a',
    status: 'PAID',
    total: new Prisma.Decimal(100),
    amountPaid: new Prisma.Decimal(100),
    amountRefunded: new Prisma.Decimal(0),
  };

  const payment = { id: 'payment-1', hospitalId: 'hospital-a', invoiceId: 'invoice-1' };

  beforeEach(() => {
    prisma = {
      refund: {
        create: jest.fn((args: any) => ({
          id: 'refund-1',
          createdAt: new Date(),
          status: 'COMPLETED',
          ...args.data,
        })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    invoicesService = {
      getTenantScopedInvoiceOrThrow: jest.fn().mockResolvedValue(paidInvoice),
      applyRefund: jest.fn(),
    };
    paymentsService = { getTenantScopedPaymentOrThrow: jest.fn().mockResolvedValue(payment) };
    service = new RefundsService(prisma, auditService, invoicesService, paymentsService);
  });

  describe('create', () => {
    it('rejects a paymentId that does not belong to the given invoice', async () => {
      paymentsService.getTenantScopedPaymentOrThrow.mockResolvedValue({
        ...payment,
        invoiceId: 'invoice-other',
      });

      await expect(
        service.create({ invoiceId: 'invoice-1', paymentId: 'payment-1', amount: 50 }, actor),
      ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
    });

    it('creates a refund and applies it to the invoice balance', async () => {
      const result = await service.create(
        { invoiceId: 'invoice-1', paymentId: 'payment-1', amount: 50, reason: 'overcharge' },
        actor,
      );

      expect(result.amount).toBe('50');
      expect(invoicesService.applyRefund).toHaveBeenCalledWith(
        prisma,
        paidInvoice,
        expect.anything(),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFUND_CREATED' }),
      );
    });
  });

  describe('listForInvoice', () => {
    it('returns 404-style NOT_FOUND via the invoice tenant check for a cross-tenant invoiceId', async () => {
      invoicesService.getTenantScopedInvoiceOrThrow.mockRejectedValue(
        Object.assign(new Error('not found'), { code: 'INVOICE_NOT_FOUND' }),
      );

      await expect(service.listForInvoice('invoice-1', actor)).rejects.toMatchObject({
        code: 'INVOICE_NOT_FOUND',
      });
    });
  });
});
