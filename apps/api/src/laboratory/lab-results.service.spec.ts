import { Role } from '@prisma/client';
import { LabResultsService } from './lab-results.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('LabResultsService', () => {
  let prisma: any;
  let auditService: any;
  let labOrdersService: any;
  let service: LabResultsService;

  const enteringTech: AuthenticatedUser = {
    userId: 'tech-1',
    email: 'tech1@hospitalos.dev',
    role: Role.LAB_TECHNICIAN,
    hospitalId: 'hospital-a',
  };
  const verifyingTech: AuthenticatedUser = {
    userId: 'tech-2',
    email: 'tech2@hospitalos.dev',
    role: Role.LAB_TECHNICIAN,
    hospitalId: 'hospital-a',
  };

  const collectedItem = {
    id: 'item-1',
    labOrderId: 'order-1',
    labOrder: { hospitalId: 'hospital-a', patientId: 'patient-1' },
    status: 'COLLECTED',
    result: null,
  };

  const enteredResult = {
    id: 'result-1',
    hospitalId: 'hospital-a',
    labOrderItemId: 'item-1',
    patientId: 'patient-1',
    value: '95',
    unit: 'mg/dL',
    referenceRange: null,
    flag: null,
    status: 'ENTERED',
    enteredByUserId: 'tech-1',
    enteredAt: new Date(),
    verifiedByUserId: null,
    verifiedAt: null,
    amendsId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      labResult: {
        create: jest.fn((args: any) => ({ ...enteredResult, id: 'result-new', ...args.data })),
        update: jest.fn((args: any) => ({ ...enteredResult, ...args.data })),
        findUnique: jest.fn(),
      },
      labOrderItem: {
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn((args: any) => ({ id: 'item-new', ...args.data })),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    labOrdersService = {
      getTenantScopedLabOrderItemOrThrow: jest.fn().mockResolvedValue(collectedItem),
      recomputeOrderStatus: jest.fn().mockResolvedValue(undefined),
    };
    service = new LabResultsService(prisma, auditService, labOrdersService);
  });

  describe('create', () => {
    it('rejects entering a result before the specimen is collected', async () => {
      labOrdersService.getTenantScopedLabOrderItemOrThrow.mockResolvedValue({
        ...collectedItem,
        status: 'ORDERED',
      });

      await expect(service.create('item-1', { value: '95' }, enteringTech)).rejects.toMatchObject({
        code: 'LAB_ORDER_ITEM_NOT_COLLECTED',
      });
    });

    it('rejects entering a second result for the same item', async () => {
      labOrdersService.getTenantScopedLabOrderItemOrThrow.mockResolvedValue({
        ...collectedItem,
        result: enteredResult,
      });

      await expect(service.create('item-1', { value: '95' }, enteringTech)).rejects.toMatchObject({
        code: 'LAB_RESULT_ALREADY_ENTERED',
      });
    });

    it('enters a result, completes the item, and recomputes the order', async () => {
      const result = await service.create('item-1', { value: '95', unit: 'mg/dL' }, enteringTech);

      expect(result.status).toBe('ENTERED');
      expect(prisma.labOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { status: 'COMPLETED' },
      });
      expect(labOrdersService.recomputeOrderStatus).toHaveBeenCalledWith('order-1', prisma);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LAB_RESULT_ENTERED' }),
      );
    });
  });

  describe('update', () => {
    it('rejects editing a result that is not ENTERED', async () => {
      prisma.labResult.findUnique.mockResolvedValue({ ...enteredResult, status: 'VERIFIED' });

      await expect(
        service.update('result-1', { value: '100' }, enteringTech),
      ).rejects.toMatchObject({ code: 'LAB_RESULT_NOT_EDITABLE' });
    });

    it('updates an ENTERED result', async () => {
      prisma.labResult.findUnique.mockResolvedValue(enteredResult);

      const result = await service.update('result-1', { value: '100' }, enteringTech);
      expect(result.value).toBe('100');
    });
  });

  describe('verify', () => {
    it('rejects the enterer verifying their own result (maker-checker)', async () => {
      prisma.labResult.findUnique.mockResolvedValue(enteredResult);

      await expect(service.verify('result-1', enteringTech)).rejects.toMatchObject({
        code: 'SELF_VERIFICATION_FORBIDDEN',
      });
    });

    it('rejects verifying a result that is not pending verification', async () => {
      prisma.labResult.findUnique.mockResolvedValue({ ...enteredResult, status: 'VERIFIED' });

      await expect(service.verify('result-1', verifyingTech)).rejects.toMatchObject({
        code: 'LAB_RESULT_NOT_PENDING_VERIFICATION',
      });
    });

    it('verifies a result entered by a different user', async () => {
      prisma.labResult.findUnique.mockResolvedValue(enteredResult);

      const result = await service.verify('result-1', verifyingTech);

      expect(result.status).toBe('VERIFIED');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LAB_RESULT_VERIFIED' }),
      );
    });
  });

  describe('amend', () => {
    it('rejects amending a result that has not been verified', async () => {
      prisma.labResult.findUnique.mockResolvedValue(enteredResult);

      await expect(
        service.amend('result-1', { value: '110' }, verifyingTech),
      ).rejects.toMatchObject({ code: 'LAB_RESULT_NOT_VERIFIED' });
    });

    it('marks the original AMENDED and creates a new item + result referencing it', async () => {
      const verified = { ...enteredResult, status: 'VERIFIED' };
      prisma.labResult.findUnique.mockResolvedValue(verified);
      prisma.labOrderItem.findUniqueOrThrow.mockResolvedValue({
        id: 'item-1',
        labOrderId: 'order-1',
        labTestId: 'labtest-1',
        specimenType: 'Blood',
        collectedAt: new Date(),
        collectedByUserId: 'tech-1',
      });

      const result = await service.amend('result-1', { value: '110' }, verifyingTech);

      expect(prisma.labResult.update).toHaveBeenCalledWith({
        where: { id: 'result-1' },
        data: { status: 'AMENDED' },
      });
      expect(prisma.labOrderItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ labOrderId: 'order-1', labTestId: 'labtest-1' }),
        }),
      );
      expect(result.amendsId).toBe('result-1');
      expect(labOrdersService.recomputeOrderStatus).toHaveBeenCalledWith('order-1', prisma);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LAB_RESULT_AMENDED' }),
      );
    });
  });
});
