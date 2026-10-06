import { Role } from '@prisma/client';
import { DispenseService } from './dispense.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('DispenseService', () => {
  let prisma: any;
  let auditService: any;
  let stockBatchesService: any;
  let service: DispenseService;

  const actor: AuthenticatedUser = {
    userId: 'pharmacist-1',
    email: 'pharmacist@hospitalos.dev',
    role: Role.PHARMACIST,
    hospitalId: 'hospital-a',
  };

  const finalizedPrescription = {
    id: 'prescription-1',
    hospitalId: 'hospital-a',
    status: 'FINALIZED',
    patientId: 'patient-1',
  };
  const item = {
    id: 'item-1',
    medicineId: 'medicine-1',
    quantity: 10,
    prescription: finalizedPrescription,
  };

  const batchA = { id: 'batch-a', quantityRemaining: 4, expiryDate: new Date('2026-01-01') };
  const batchB = { id: 'batch-b', quantityRemaining: 20, expiryDate: new Date('2027-01-01') };

  beforeEach(() => {
    prisma = {
      prescriptionItem: { findUnique: jest.fn().mockResolvedValue(item) },
      dispenseRecord: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: null } }),
        create: jest.fn((args: any) => ({ id: `record-${Math.random()}`, ...args.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      stockBatch: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      stockMovement: { create: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    stockBatchesService = { applyMovement: jest.fn(), findOneForTenant: jest.fn() };
    service = new DispenseService(prisma, auditService, stockBatchesService);
  });

  describe('create', () => {
    it('rejects dispensing for an unfinalized prescription', async () => {
      prisma.prescriptionItem.findUnique.mockResolvedValue({
        ...item,
        prescription: { ...finalizedPrescription, status: 'DRAFT' },
      });

      await expect(
        service.create({ prescriptionItemId: 'item-1', quantity: 5 }, actor),
      ).rejects.toMatchObject({ code: 'PRESCRIPTION_NOT_FINALIZED' });
    });

    it('rejects dispensing more than the remaining undispensed quantity', async () => {
      prisma.dispenseRecord.aggregate.mockResolvedValue({ _sum: { quantity: 8 } });

      await expect(
        service.create({ prescriptionItemId: 'item-1', quantity: 5 }, actor),
      ).rejects.toMatchObject({ code: 'EXCEEDS_PRESCRIBED_QUANTITY' });
    });

    it('rejects dispensing when no active unexpired stock remains', async () => {
      prisma.stockBatch.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ prescriptionItemId: 'item-1', quantity: 5 }, actor),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    });

    it('dispenses fully from a single batch with enough stock', async () => {
      prisma.stockBatch.findFirst.mockResolvedValue(batchB);
      prisma.stockBatch.findUniqueOrThrow.mockResolvedValue({ ...batchB, quantityRemaining: 15 });

      const result = await service.create({ prescriptionItemId: 'item-1', quantity: 5 }, actor);

      expect(result).toHaveLength(1);
      expect(prisma.stockBatch.updateMany).toHaveBeenCalledWith({
        where: { id: batchB.id, quantityRemaining: { gte: 5 } },
        data: { quantityRemaining: { decrement: 5 } },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'MEDICINE_DISPENSED' }),
      );
    });

    it('spans two batches in FEFO order when the earliest-expiring one is insufficient', async () => {
      prisma.stockBatch.findFirst.mockResolvedValueOnce(batchA).mockResolvedValueOnce(batchB);
      prisma.stockBatch.findUniqueOrThrow
        .mockResolvedValueOnce({ ...batchA, quantityRemaining: 0 })
        .mockResolvedValueOnce({ ...batchB, quantityRemaining: 19 });

      const result = await service.create({ prescriptionItemId: 'item-1', quantity: 5 }, actor);

      expect(result).toHaveLength(2);
      expect(prisma.stockBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-a' },
        data: { status: 'DEPLETED' },
      });
      expect(prisma.stockBatch.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'batch-a', quantityRemaining: { gte: 4 } },
        data: { quantityRemaining: { decrement: 4 } },
      });
      expect(prisma.stockBatch.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'batch-b', quantityRemaining: { gte: 1 } },
        data: { quantityRemaining: { decrement: 1 } },
      });
    });
  });

  describe('returnStock', () => {
    const record = {
      id: 'record-1',
      hospitalId: 'hospital-a',
      quantity: 5,
      stockBatchId: 'batch-a',
      stockBatch: batchA,
    };

    it('rejects returning more than was originally dispensed', async () => {
      prisma.dispenseRecord.findUnique.mockResolvedValue(record);

      await expect(service.returnStock('record-1', { quantity: 10 }, actor)).rejects.toMatchObject({
        code: 'RETURN_EXCEEDS_DISPENSED',
      });
    });

    it('credits the originating batch and audits the return', async () => {
      prisma.dispenseRecord.findUnique.mockResolvedValue(record);
      stockBatchesService.findOneForTenant.mockResolvedValue({ id: 'batch-a' });

      await service.returnStock('record-1', { quantity: 2, notes: 'unused' }, actor);

      expect(stockBatchesService.applyMovement).toHaveBeenCalledWith(
        prisma,
        batchA,
        'RETURN',
        2,
        'pharmacist-1',
        expect.objectContaining({ referenceType: 'DispenseRecord', referenceId: 'record-1' }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STOCK_RETURNED' }),
      );
    });
  });
});
