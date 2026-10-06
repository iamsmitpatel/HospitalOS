import { Prisma, Role } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('PaymentsService', () => {
  let prisma: any;
  let auditService: any;
  let invoicesService: any;
  let service: PaymentsService;

  const actor: AuthenticatedUser = {
    userId: 'receptionist-1',
    email: 'reception@hospitalos.dev',
    role: Role.RECEPTIONIST,
    hospitalId: 'hospital-a',
  };

  const issuedInvoice = {
    id: 'invoice-1',
    hospitalId: 'hospital-a',
    status: 'ISSUED',
    total: new Prisma.Decimal(100),
    amountPaid: new Prisma.Decimal(0),
  };

  const existingPayment = {
    id: 'payment-1',
    hospitalId: 'hospital-a',
    invoiceId: 'invoice-1',
    amount: new Prisma.Decimal(100),
    method: 'CASH',
    status: 'SUCCESS',
    referenceNumber: null,
    idempotencyKey: 'retry-key-1',
    createdByUserId: 'receptionist-1',
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      payment: {
        create: jest.fn((args: any) => ({ ...existingPayment, id: 'payment-new', ...args.data })),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    invoicesService = {
      getTenantScopedInvoiceOrThrow: jest.fn().mockResolvedValue(issuedInvoice),
      applyPayment: jest.fn(),
    };
    service = new PaymentsService(prisma, auditService, invoicesService);
  });

  describe('create', () => {
    it('returns the existing payment for a repeated idempotency key instead of creating a second one', async () => {
      prisma.payment.findUnique.mockResolvedValue(existingPayment);

      const result = await service.create(
        { invoiceId: 'invoice-1', amount: 100, method: 'CASH', idempotencyKey: 'retry-key-1' },
        actor,
      );

      expect(result.id).toBe('payment-1');
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(invoicesService.applyPayment).not.toHaveBeenCalled();
    });

    it('creates a payment and applies it to the invoice balance', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      const result = await service.create(
        { invoiceId: 'invoice-1', amount: 100, method: 'CASH' },
        actor,
      );

      expect(result.amount).toBe('100');
      expect(invoicesService.applyPayment).toHaveBeenCalledWith(
        prisma,
        issuedInvoice,
        expect.anything(),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PAYMENT_CREATED' }),
      );
    });

    it('falls back to the existing payment when a concurrent retry loses the unique-key race', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.payment.create.mockImplementation(() => {
        throw new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '0.0.0',
        });
      });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(existingPayment);

      const result = await service.create(
        { invoiceId: 'invoice-1', amount: 100, method: 'CASH', idempotencyKey: 'retry-key-1' },
        actor,
      );

      expect(result.id).toBe('payment-1');
    });
  });

  describe('getTenantScopedPaymentOrThrow', () => {
    it('returns 404-style NOT_FOUND for a different-hospital payment', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...existingPayment, hospitalId: 'hospital-b' });

      await expect(service.getTenantScopedPaymentOrThrow('payment-1', actor)).rejects.toMatchObject(
        { code: 'PAYMENT_NOT_FOUND' },
      );
    });
  });
});
