import { Role } from '@prisma/client';
import { MedicinesService } from './medicines.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('MedicinesService', () => {
  let prisma: any;
  let auditService: any;
  let service: MedicinesService;

  const actor: AuthenticatedUser = {
    userId: 'pharmacist-1',
    email: 'pharmacist@hospitalos.dev',
    role: Role.PHARMACIST,
    hospitalId: 'hospital-a',
  };

  const medicine = {
    id: 'medicine-1',
    hospitalId: 'hospital-a',
    name: 'Paracetamol',
    genericName: null,
    brandName: null,
    strength: null,
    form: null,
    unit: null,
    isActive: true,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      medicine: {
        create: jest.fn((args: any) => ({ ...medicine, ...args.data })),
        update: jest.fn((args: any) => ({ ...medicine, ...args.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    auditService = { log: jest.fn() };
    service = new MedicinesService(prisma, auditService);
  });

  it('creates a medicine and audits it', async () => {
    const result = await service.create({ name: 'Paracetamol' }, actor);
    expect(result.name).toBe('Paracetamol');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MEDICINE_CREATED' }),
    );
  });

  it('updates a medicine and audits it', async () => {
    prisma.medicine.findUnique.mockResolvedValue(medicine);

    const result = await service.update('medicine-1', { isActive: false }, actor);
    expect(result.isActive).toBe(false);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MEDICINE_UPDATED' }),
    );
  });

  it('returns 404-style NOT_FOUND for a different-hospital medicine', async () => {
    prisma.medicine.findUnique.mockResolvedValue({ ...medicine, hospitalId: 'hospital-b' });

    await expect(service.getTenantScopedMedicineOrThrow('medicine-1', actor)).rejects.toMatchObject(
      { code: 'MEDICINE_NOT_FOUND' },
    );
  });
});
