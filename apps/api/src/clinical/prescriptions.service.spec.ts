import { Role } from '@prisma/client';
import { PrescriptionsService } from './prescriptions.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('PrescriptionsService', () => {
  let prisma: any;
  let auditService: any;
  let encountersService: any;
  let service: PrescriptionsService;

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

  const activeMedicine = {
    id: 'medicine-1',
    hospitalId: 'hospital-a',
    isActive: true,
    name: 'Paracetamol',
  };

  const draftItem = {
    medicineId: 'medicine-1',
    dosage: '500mg',
    frequency: 'Twice daily',
    duration: '5 days',
    quantity: 10,
  };

  const draftPrescription = {
    id: 'prescription-1',
    hospitalId: 'hospital-a',
    encounterId: 'encounter-1',
    patientId: 'patient-1',
    doctorProfileId: 'doctor-1',
    status: 'DRAFT',
    notes: null,
    amendedFromId: null,
    createdByUserId: 'user-doctor-1',
    finalizedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [{ id: 'item-1', ...draftItem }],
  };

  beforeEach(() => {
    prisma = {
      prescription: {
        create: jest.fn((args: any) => ({
          ...draftPrescription,
          id: 'prescription-new',
          ...args.data,
          items: args.data.items.create,
        })),
        update: jest.fn((args: any) => ({
          ...draftPrescription,
          ...args.data,
          items: args.include?.items ? draftPrescription.items : undefined,
        })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      prescriptionItem: { deleteMany: jest.fn() },
      medicine: { findMany: jest.fn().mockResolvedValue([activeMedicine]) },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    encountersService = {
      getTenantScopedEncounterOrThrow: jest.fn().mockResolvedValue(inProgressEncounter),
      assertOwnEncounter: jest.fn().mockResolvedValue({ id: 'doctor-1' }),
    };
    service = new PrescriptionsService(prisma, auditService, encountersService);
  });

  describe('create', () => {
    it('rejects a medicine that does not exist in this hospital', async () => {
      prisma.medicine.findMany.mockResolvedValue([]);

      await expect(
        service.create('encounter-1', { items: [draftItem] }, actor),
      ).rejects.toMatchObject({ code: 'MEDICINE_NOT_FOUND' });
    });

    it('rejects an inactive medicine', async () => {
      prisma.medicine.findMany.mockResolvedValue([{ ...activeMedicine, isActive: false }]);

      await expect(
        service.create('encounter-1', { items: [draftItem] }, actor),
      ).rejects.toMatchObject({ code: 'MEDICINE_INACTIVE' });
    });

    it('creates a DRAFT prescription with its items and audits it', async () => {
      const result = await service.create('encounter-1', { items: [draftItem] }, actor);

      expect(result.status).toBe('DRAFT');
      expect(result.items).toHaveLength(1);
      expect(prisma.prescription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hospitalId: 'hospital-a',
            encounterId: 'encounter-1',
            doctorProfileId: 'doctor-1',
            createdByUserId: 'user-doctor-1',
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRESCRIPTION_CREATED' }),
      );
    });
  });

  describe('update', () => {
    it('rejects editing a prescription that is not DRAFT', async () => {
      prisma.prescription.findUnique.mockResolvedValue({
        ...draftPrescription,
        status: 'FINALIZED',
      });

      await expect(service.update('prescription-1', { notes: 'x' }, actor)).rejects.toMatchObject({
        code: 'PRESCRIPTION_NOT_DRAFT',
      });
    });

    it('replaces items on a DRAFT prescription', async () => {
      prisma.prescription.findUnique.mockResolvedValue(draftPrescription);

      await service.update('prescription-1', { items: [draftItem] }, actor);

      expect(prisma.prescriptionItem.deleteMany).toHaveBeenCalledWith({
        where: { prescriptionId: 'prescription-1' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRESCRIPTION_UPDATED' }),
      );
    });
  });

  describe('finalize', () => {
    it('rejects finalizing a prescription that is not DRAFT', async () => {
      prisma.prescription.findUnique.mockResolvedValue({
        ...draftPrescription,
        status: 'FINALIZED',
      });

      await expect(service.finalize('prescription-1', actor)).rejects.toMatchObject({
        code: 'PRESCRIPTION_NOT_DRAFT',
      });
    });

    it('finalizes a DRAFT prescription', async () => {
      prisma.prescription.findUnique.mockResolvedValue(draftPrescription);
      prisma.prescription.update.mockReturnValue({
        ...draftPrescription,
        status: 'FINALIZED',
        finalizedAt: new Date(),
        items: draftPrescription.items,
      });

      const result = await service.finalize('prescription-1', actor);
      expect(result.status).toBe('FINALIZED');
    });
  });

  describe('amend', () => {
    it('rejects amending a prescription that is not FINALIZED', async () => {
      prisma.prescription.findUnique.mockResolvedValue(draftPrescription);

      await expect(
        service.amend('prescription-1', { items: [draftItem] }, actor),
      ).rejects.toMatchObject({ code: 'PRESCRIPTION_NOT_FINALIZED' });
    });

    it('marks the original AMENDED and creates a new DRAFT referencing it', async () => {
      const finalized = { ...draftPrescription, status: 'FINALIZED', finalizedAt: new Date() };
      prisma.prescription.findUnique.mockResolvedValue(finalized);

      const result = await service.amend('prescription-1', { items: [draftItem] }, actor);

      expect(prisma.prescription.update).toHaveBeenCalledWith({
        where: { id: 'prescription-1' },
        data: { status: 'AMENDED' },
      });
      expect(result.amendedFromId).toBe('prescription-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRESCRIPTION_AMENDED' }),
      );
    });
  });
});
