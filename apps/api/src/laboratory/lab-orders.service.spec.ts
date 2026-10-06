import { Role } from '@prisma/client';
import { LabOrdersService, computeLabOrderStatus } from './lab-orders.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('computeLabOrderStatus', () => {
  it('returns ORDERED while any active item has not been collected', () => {
    expect(computeLabOrderStatus(['ORDERED', 'COLLECTED'])).toBe('ORDERED');
  });

  it('returns COLLECTED once every active item is collected and none completed', () => {
    expect(computeLabOrderStatus(['COLLECTED', 'COLLECTED'])).toBe('COLLECTED');
  });

  it('returns PROCESSING once at least one item is completed but not all', () => {
    expect(computeLabOrderStatus(['COMPLETED', 'COLLECTED'])).toBe('PROCESSING');
  });

  it('returns COMPLETED once every active item is completed', () => {
    expect(computeLabOrderStatus(['COMPLETED', 'COMPLETED'])).toBe('COMPLETED');
  });

  it('ignores cancelled items when rolling up status', () => {
    expect(computeLabOrderStatus(['COMPLETED', 'CANCELLED'])).toBe('COMPLETED');
  });

  it('returns CANCELLED when every item has been cancelled', () => {
    expect(computeLabOrderStatus(['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
  });
});

describe('LabOrdersService', () => {
  let prisma: any;
  let auditService: any;
  let encountersService: any;
  let labTestsService: any;
  let service: LabOrdersService;

  const actor: AuthenticatedUser = {
    userId: 'user-doctor-1',
    email: 'doc@hospitalos.dev',
    role: Role.DOCTOR,
    hospitalId: 'hospital-a',
  };

  const inProgressEncounter = {
    id: 'encounter-1',
    hospitalId: 'hospital-a',
    patientId: 'patient-1',
    doctorProfileId: 'doctor-1',
    status: 'IN_PROGRESS',
  };

  const activeLabTest = { id: 'labtest-1', hospitalId: 'hospital-a', isActive: true, name: 'CBC' };

  const order = {
    id: 'order-1',
    hospitalId: 'hospital-a',
    encounterId: 'encounter-1',
    patientId: 'patient-1',
    doctorProfileId: 'doctor-1',
    status: 'ORDERED',
    orderedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [{ id: 'item-1', labTestId: 'labtest-1', status: 'ORDERED', result: null }],
  };

  beforeEach(() => {
    prisma = {
      labOrder: {
        create: jest.fn((args: any) => ({
          ...order,
          id: 'order-new',
          ...args.data,
          items: args.data.items.create.map((i: any, idx: number) => ({
            id: `item-${idx + 1}`,
            ...i,
            status: 'ORDERED',
            result: null,
          })),
        })),
        update: jest.fn((args: any) => ({ ...order, ...args.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      labOrderItem: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue(order.items),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    encountersService = {
      getTenantScopedEncounterOrThrow: jest.fn().mockResolvedValue(inProgressEncounter),
      assertOwnEncounter: jest.fn().mockResolvedValue({ id: 'doctor-1' }),
    };
    labTestsService = {
      getTenantScopedLabTestOrThrow: jest.fn().mockResolvedValue(activeLabTest),
    };
    service = new LabOrdersService(prisma, auditService, encountersService, labTestsService);
  });

  describe('create', () => {
    it('rejects ordering on a cancelled encounter', async () => {
      encountersService.getTenantScopedEncounterOrThrow.mockResolvedValue({
        ...inProgressEncounter,
        status: 'CANCELLED',
      });

      await expect(
        service.create('encounter-1', { items: [{ labTestId: 'labtest-1' }] }, actor),
      ).rejects.toMatchObject({ code: 'ENCOUNTER_CANCELLED' });
    });

    it('rejects an inactive lab test', async () => {
      labTestsService.getTenantScopedLabTestOrThrow.mockResolvedValue({
        ...activeLabTest,
        isActive: false,
      });

      await expect(
        service.create('encounter-1', { items: [{ labTestId: 'labtest-1' }] }, actor),
      ).rejects.toMatchObject({ code: 'LAB_TEST_INACTIVE' });
    });

    it('creates an order with its items and audits it', async () => {
      const result = await service.create(
        'encounter-1',
        { items: [{ labTestId: 'labtest-1' }] },
        actor,
      );

      expect(result.items).toHaveLength(1);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LAB_ORDER_CREATED' }),
      );
    });
  });

  describe('cancel', () => {
    it('rejects cancelling a COMPLETED order', async () => {
      prisma.labOrder.findUnique.mockResolvedValue({ ...order, status: 'COMPLETED' });

      await expect(service.cancel('order-1', actor)).rejects.toMatchObject({
        code: 'LAB_ORDER_NOT_CANCELLABLE',
      });
    });

    it('cancels the order and its non-completed items', async () => {
      prisma.labOrder.findUnique.mockResolvedValue(order);

      const result = await service.cancel('order-1', actor);

      expect(prisma.labOrderItem.updateMany).toHaveBeenCalledWith({
        where: { labOrderId: 'order-1', status: { in: ['ORDERED', 'COLLECTED'] } },
        data: { status: 'CANCELLED' },
      });
      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('collectSpecimen', () => {
    const orderedItem = {
      id: 'item-1',
      labOrderId: 'order-1',
      labOrder: { hospitalId: 'hospital-a' },
      status: 'ORDERED',
      result: null,
    };

    it('rejects collecting a specimen for an item that is not ORDERED', async () => {
      prisma.labOrderItem.findUnique.mockResolvedValue({ ...orderedItem, status: 'COLLECTED' });

      await expect(
        service.collectSpecimen('item-1', { specimenType: 'Blood' }, actor),
      ).rejects.toMatchObject({ code: 'LAB_ORDER_ITEM_NOT_ORDERED' });
    });

    it('collects the specimen and recomputes the order status', async () => {
      prisma.labOrderItem.findUnique.mockResolvedValue(orderedItem);
      prisma.labOrderItem.findMany.mockResolvedValue([{ status: 'COLLECTED' }]);

      await service.collectSpecimen('item-1', { specimenType: 'Blood' }, actor);

      expect(prisma.labOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({ status: 'COLLECTED', specimenType: 'Blood' }),
      });
      expect(prisma.labOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-1' }, data: { status: 'COLLECTED' } }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SPECIMEN_COLLECTED' }),
      );
    });
  });
});
