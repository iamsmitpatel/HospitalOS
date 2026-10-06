import { Role } from '@prisma/client';
import { ServicesService } from './services.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('ServicesService', () => {
  let prisma: any;
  let auditService: any;
  let service: ServicesService;

  const actor: AuthenticatedUser = {
    userId: 'accountant-1',
    email: 'accountant@hospitalos.dev',
    role: Role.ACCOUNTANT,
    hospitalId: 'hospital-a',
  };

  const svc = {
    id: 'service-1',
    hospitalId: 'hospital-a',
    name: 'General Consultation',
    code: 'CONSULT-GEN',
    category: 'CONSULTATION',
    isActive: true,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      service: {
        create: jest.fn((args: any) => ({ ...svc, ...args.data })),
        update: jest.fn((args: any) => ({ ...svc, ...args.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      servicePrice: {
        create: jest.fn((args: any) => ({ id: 'price-new', effectiveTo: null, ...args.data })),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    service = new ServicesService(prisma, auditService);
  });

  describe('create', () => {
    it('rejects a duplicate code within the same hospital', async () => {
      prisma.service.findUnique.mockResolvedValue(svc);

      await expect(
        service.create({ name: 'General Consultation', code: 'CONSULT-GEN' }, actor),
      ).rejects.toMatchObject({ code: 'SERVICE_CODE_TAKEN' });
    });

    it('creates a service and audits it', async () => {
      prisma.service.findUnique.mockResolvedValue(null);

      const result = await service.create(
        { name: 'General Consultation', code: 'CONSULT-GEN' },
        actor,
      );
      expect(result.code).toBe('CONSULT-GEN');
      expect(result.currentPrice).toBeNull();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SERVICE_CREATED' }),
      );
    });
  });

  describe('setPrice', () => {
    it('closes the previous current price and opens a new one', async () => {
      prisma.service.findUnique.mockResolvedValue(svc);

      const result = await service.setPrice('service-1', { amount: 500 }, actor);

      expect(prisma.servicePrice.updateMany).toHaveBeenCalledWith({
        where: { serviceId: 'service-1', effectiveTo: null },
        data: { effectiveTo: expect.any(Date) },
      });
      expect(result.amount).toBe('500');
      expect(result.effectiveTo).toBeNull();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SERVICE_PRICE_SET' }),
      );
    });
  });

  describe('getTenantScopedServiceOrThrow', () => {
    it('returns 404-style NOT_FOUND for a different-hospital service', async () => {
      prisma.service.findUnique.mockResolvedValue({ ...svc, hospitalId: 'hospital-b' });

      await expect(service.getTenantScopedServiceOrThrow('service-1', actor)).rejects.toMatchObject(
        { code: 'SERVICE_NOT_FOUND' },
      );
    });
  });
});
