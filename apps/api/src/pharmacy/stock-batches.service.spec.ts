import { Role } from '@prisma/client';
import { StockBatchesService } from './stock-batches.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('StockBatchesService', () => {
  let prisma: any;
  let auditService: any;
  let medicinesService: any;
  let service: StockBatchesService;

  const actor: AuthenticatedUser = {
    userId: 'pharmacist-1',
    email: 'pharmacist@hospitalos.dev',
    role: Role.PHARMACIST,
    hospitalId: 'hospital-a',
  };

  const activeMedicine = { id: 'medicine-1', hospitalId: 'hospital-a', isActive: true };

  const activeBatch = {
    id: 'batch-1',
    hospitalId: 'hospital-a',
    medicineId: 'medicine-1',
    batchNumber: 'B001',
    quantityReceived: 100,
    quantityRemaining: 10,
    expiryDate: new Date('2030-01-01'),
    purchasePrice: null,
    status: 'ACTIVE',
    receivedAt: new Date(),
    createdByUserId: 'pharmacist-1',
  };

  beforeEach(() => {
    prisma = {
      stockBatch: {
        create: jest.fn((args: any) => ({ ...activeBatch, ...args.data })),
        update: jest.fn((args: any) => ({ ...activeBatch, ...args.data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
      },
      stockMovement: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    medicinesService = {
      getTenantScopedMedicineOrThrow: jest.fn().mockResolvedValue(activeMedicine),
    };
    service = new StockBatchesService(prisma, auditService, medicinesService);
  });

  describe('receiveStock', () => {
    it('rejects receiving stock for an inactive medicine', async () => {
      medicinesService.getTenantScopedMedicineOrThrow.mockResolvedValue({
        ...activeMedicine,
        isActive: false,
      });

      await expect(
        service.receiveStock(
          'medicine-1',
          { batchNumber: 'B001', quantityReceived: 100, expiryDate: '2030-01-01' },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'MEDICINE_INACTIVE' });
    });

    it('creates a batch, logs a PURCHASE movement, and audits it', async () => {
      const result = await service.receiveStock(
        'medicine-1',
        { batchNumber: 'B001', quantityReceived: 100, expiryDate: '2030-01-01' },
        actor,
      );

      expect(result.quantityRemaining).toBe(100);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'PURCHASE', quantityDelta: 100 }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STOCK_RECEIVED' }),
      );
    });

    it('surfaces a duplicate batch number as a clean conflict', async () => {
      const { Prisma } = await import('@prisma/client');
      prisma.stockBatch.create.mockImplementation(() => {
        throw new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '0.0.0',
        });
      });

      await expect(
        service.receiveStock(
          'medicine-1',
          { batchNumber: 'B001', quantityReceived: 100, expiryDate: '2030-01-01' },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'BATCH_NUMBER_TAKEN' });
    });
  });

  describe('adjust', () => {
    it('rejects an adjustment that would drive quantity negative', async () => {
      prisma.stockBatch.findUnique.mockResolvedValue(activeBatch);
      prisma.stockBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.adjust('batch-1', { delta: -20 }, actor)).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
      });
    });

    it('applies a positive adjustment and logs an ADJUSTMENT movement', async () => {
      prisma.stockBatch.findUnique.mockResolvedValue(activeBatch);
      prisma.stockBatch.update.mockResolvedValue({ ...activeBatch, quantityRemaining: 15 });

      const result = await service.adjust('batch-1', { delta: 5, notes: 'recount' }, actor);

      expect(result.quantityRemaining).toBe(15);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'ADJUSTMENT', quantityDelta: 5 }),
        }),
      );
    });

    it('flips a batch to DEPLETED once a decrement reaches zero', async () => {
      prisma.stockBatch.findUnique.mockResolvedValue(activeBatch);
      prisma.stockBatch.findUniqueOrThrow.mockResolvedValue({
        ...activeBatch,
        quantityRemaining: 0,
      });
      prisma.stockBatch.update.mockResolvedValue({
        ...activeBatch,
        quantityRemaining: 0,
        status: 'DEPLETED',
      });

      const result = await service.adjust('batch-1', { delta: -10 }, actor);
      expect(result.status).toBe('DEPLETED');
    });
  });

  describe('markExpired', () => {
    it('rejects marking a non-ACTIVE batch as expired', async () => {
      prisma.stockBatch.findUnique.mockResolvedValue({ ...activeBatch, status: 'DEPLETED' });

      await expect(service.markExpired('batch-1', actor)).rejects.toMatchObject({
        code: 'STOCK_BATCH_NOT_ACTIVE',
      });
    });

    it('zeroes remaining quantity and sets status EXPIRED', async () => {
      prisma.stockBatch.findUnique.mockResolvedValue(activeBatch);
      prisma.stockBatch.findUniqueOrThrow.mockResolvedValue({
        ...activeBatch,
        quantityRemaining: 0,
      });
      prisma.stockBatch.update.mockImplementation((args: any) => ({
        ...activeBatch,
        ...args.data,
      }));

      const result = await service.markExpired('batch-1', actor);

      expect(result.status).toBe('EXPIRED');
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'EXPIRED', quantityDelta: -10 }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STOCK_EXPIRED' }),
      );
    });
  });
});
