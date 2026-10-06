import { Prisma, Role } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const d = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

describe('InvoicesService', () => {
  let prisma: any;
  let auditService: any;
  let servicesService: any;
  let service: InvoicesService;

  const actor: AuthenticatedUser = {
    userId: 'receptionist-1',
    email: 'reception@hospitalos.dev',
    role: Role.RECEPTIONIST,
    hospitalId: 'hospital-a',
  };

  const patient = { id: 'patient-1', hospitalId: 'hospital-a' };
  const hospital = { id: 'hospital-a', code: 'HOS', invoiceSequence: 1 };

  const draftInvoice = {
    id: 'invoice-1',
    hospitalId: 'hospital-a',
    patientId: 'patient-1',
    encounterId: null,
    invoiceNumber: 'HOS-INV-000001',
    status: 'DRAFT',
    subtotal: d(100),
    discountAmount: d(0),
    taxRate: d(0),
    taxAmount: d(0),
    total: d(100),
    amountPaid: d(0),
    amountRefunded: d(0),
    currency: 'INR',
    issuedAt: null,
    createdByUserId: 'receptionist-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
  };

  beforeEach(() => {
    prisma = {
      patient: { findUnique: jest.fn().mockResolvedValue(patient) },
      encounter: { findUnique: jest.fn() },
      hospital: { update: jest.fn().mockResolvedValue(hospital) },
      invoice: {
        create: jest.fn((args: any) => ({
          ...draftInvoice,
          ...args.data,
          items: args.data.items?.create ?? [],
        })),
        update: jest.fn((args: any) => ({ ...draftInvoice, ...args.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    servicesService = {
      getTenantScopedServiceOrThrow: jest.fn(),
      getCurrentPrice: jest.fn(),
    };
    service = new InvoicesService(prisma, auditService, servicesService);
  });

  describe('create', () => {
    it('rejects a patient outside the tenant', async () => {
      prisma.patient.findUnique.mockResolvedValue({ ...patient, hospitalId: 'hospital-b' });

      await expect(
        service.create(
          { patientId: 'patient-1', items: [{ description: 'X-ray', unitPrice: 100 }] },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND' });
    });

    it('rejects a free-form item missing description/unitPrice', async () => {
      await expect(
        service.create({ patientId: 'patient-1', items: [{ quantity: 1 }] }, actor),
      ).rejects.toMatchObject({ code: 'FREEFORM_ITEM_INCOMPLETE' });
    });

    it('rejects an inactive catalog service', async () => {
      servicesService.getTenantScopedServiceOrThrow.mockResolvedValue({
        id: 'service-1',
        name: 'X-ray',
        isActive: false,
      });

      await expect(
        service.create({ patientId: 'patient-1', items: [{ serviceId: 'service-1' }] }, actor),
      ).rejects.toMatchObject({ code: 'SERVICE_INACTIVE' });
    });

    it('rejects a catalog service with no current price', async () => {
      servicesService.getTenantScopedServiceOrThrow.mockResolvedValue({
        id: 'service-1',
        name: 'X-ray',
        isActive: true,
      });
      servicesService.getCurrentPrice.mockResolvedValue(null);

      await expect(
        service.create({ patientId: 'patient-1', items: [{ serviceId: 'service-1' }] }, actor),
      ).rejects.toMatchObject({ code: 'SERVICE_PRICE_NOT_SET' });
    });

    it('rejects an invoice-level discount larger than the subtotal', async () => {
      await expect(
        service.create(
          {
            patientId: 'patient-1',
            items: [{ description: 'X-ray', unitPrice: 100 }],
            discountAmount: 200,
          },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'DISCOUNT_EXCEEDS_SUBTOTAL' });
    });

    it('computes subtotal/tax/total and assigns an atomic invoice number', async () => {
      const result = await service.create(
        {
          patientId: 'patient-1',
          items: [{ description: 'X-ray', unitPrice: 100, quantity: 2 }],
          taxRate: 0.1,
        },
        actor,
      );

      expect(prisma.hospital.update).toHaveBeenCalledWith({
        where: { id: 'hospital-a' },
        data: { invoiceSequence: { increment: 1 } },
      });
      expect(result.invoiceNumber).toBe('HOS-INV-000001');
      expect(result.subtotal).toBe('200');
      expect(result.taxAmount).toBe('20');
      expect(result.total).toBe('220');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVOICE_CREATED' }),
      );
    });
  });

  describe('issue', () => {
    it('rejects issuing a non-DRAFT invoice', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ ...draftInvoice, status: 'ISSUED' });

      await expect(service.issue('invoice-1', actor)).rejects.toMatchObject({
        code: 'INVOICE_NOT_DRAFT',
      });
    });

    it('issues a DRAFT invoice', async () => {
      prisma.invoice.findUnique.mockResolvedValue(draftInvoice);

      const result = await service.issue('invoice-1', actor);
      expect(result.status).toBe('ISSUED');
    });
  });

  describe('cancel', () => {
    it('rejects cancelling an invoice that already has payments', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        ...draftInvoice,
        status: 'ISSUED',
        amountPaid: d(50),
      });

      await expect(service.cancel('invoice-1', actor)).rejects.toMatchObject({
        code: 'INVOICE_HAS_PAYMENTS',
      });
    });

    it('cancels a DRAFT invoice with no payments', async () => {
      prisma.invoice.findUnique.mockResolvedValue(draftInvoice);

      const result = await service.cancel('invoice-1', actor);
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('applyPayment', () => {
    it('rejects paying a DRAFT invoice', async () => {
      await expect(service.applyPayment(prisma, draftInvoice as any, d(50))).rejects.toMatchObject({
        code: 'INVOICE_NOT_PAYABLE',
      });
    });

    it('rejects a payment that would exceed the total', async () => {
      const issued = { ...draftInvoice, status: 'ISSUED' };
      await expect(service.applyPayment(prisma, issued as any, d(150))).rejects.toMatchObject({
        code: 'PAYMENT_EXCEEDS_BALANCE',
      });
    });

    it('marks PARTIALLY_PAID when less than the total is paid', async () => {
      const issued = { ...draftInvoice, status: 'ISSUED' };
      await service.applyPayment(prisma, issued as any, d(40));

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { amountPaid: expect.anything(), status: 'PARTIALLY_PAID' },
      });
    });

    it('marks PAID once the full total is paid', async () => {
      const issued = { ...draftInvoice, status: 'ISSUED' };
      await service.applyPayment(prisma, issued as any, d(100));

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { amountPaid: expect.anything(), status: 'PAID' },
      });
    });
  });

  describe('applyRefund', () => {
    it('rejects a refund that would exceed amountPaid', async () => {
      const paid = { ...draftInvoice, status: 'PAID', amountPaid: d(100) };
      await expect(service.applyRefund(prisma, paid as any, d(150))).rejects.toMatchObject({
        code: 'REFUND_EXCEEDS_PAID',
      });
    });

    it('marks REFUNDED when the full paid amount is refunded', async () => {
      const paid = { ...draftInvoice, status: 'PAID', amountPaid: d(100) };
      await service.applyRefund(prisma, paid as any, d(100));

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { amountRefunded: expect.anything(), status: 'REFUNDED' },
      });
    });

    it('marks PARTIALLY_PAID when only part of the paid amount is refunded', async () => {
      const paid = { ...draftInvoice, status: 'PAID', amountPaid: d(100) };
      await service.applyRefund(prisma, paid as any, d(40));

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: { amountRefunded: expect.anything(), status: 'PARTIALLY_PAID' },
      });
    });
  });
});
