import { Role } from '@prisma/client';
import { DiagnosesService } from './diagnoses.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('DiagnosesService', () => {
  let prisma: any;
  let auditService: any;
  let encountersService: any;
  let service: DiagnosesService;

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

  const draftDiagnosis = {
    id: 'diagnosis-1',
    hospitalId: 'hospital-a',
    encounterId: 'encounter-1',
    patientId: 'patient-1',
    description: 'Seasonal allergy',
    diagnosisCode: null,
    type: null,
    status: 'DRAFT',
    recordedByUserId: 'user-doctor-1',
    recordedAt: new Date(),
    finalizedAt: null,
    amendedFromId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      diagnosis: {
        create: jest.fn((args: any) => ({
          ...draftDiagnosis,
          id: 'diagnosis-new',
          ...args.data,
        })),
        update: jest.fn((args: any) => ({ ...draftDiagnosis, ...args.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditService = { log: jest.fn() };
    encountersService = {
      getTenantScopedEncounterOrThrow: jest.fn().mockResolvedValue(inProgressEncounter),
      assertOwnEncounter: jest.fn().mockResolvedValue({ id: 'doctor-1' }),
    };
    service = new DiagnosesService(prisma, auditService, encountersService);
  });

  describe('create', () => {
    it('rejects adding a diagnosis to a cancelled encounter', async () => {
      encountersService.getTenantScopedEncounterOrThrow.mockResolvedValue({
        ...inProgressEncounter,
        status: 'CANCELLED',
      });

      await expect(
        service.create('encounter-1', { description: 'x' }, actor),
      ).rejects.toMatchObject({ code: 'ENCOUNTER_CANCELLED' });
    });

    it('rejects a doctor who does not own the encounter', async () => {
      encountersService.assertOwnEncounter.mockRejectedValue(
        Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }),
      );

      await expect(
        service.create('encounter-1', { description: 'x' }, actor),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('creates a DRAFT diagnosis and audits it', async () => {
      const result = await service.create(
        'encounter-1',
        { description: 'Seasonal allergy' },
        actor,
      );

      expect(result.status).toBe('DRAFT');
      expect(prisma.diagnosis.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          hospitalId: 'hospital-a',
          encounterId: 'encounter-1',
          patientId: 'patient-1',
          recordedByUserId: 'user-doctor-1',
        }),
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DIAGNOSIS_CREATED' }),
      );
    });
  });

  describe('update', () => {
    it('rejects editing a diagnosis that is not DRAFT', async () => {
      prisma.diagnosis.findUnique.mockResolvedValue({ ...draftDiagnosis, status: 'FINALIZED' });

      await expect(
        service.update('diagnosis-1', { description: 'revised' }, actor),
      ).rejects.toMatchObject({ code: 'DIAGNOSIS_NOT_DRAFT' });
    });

    it('updates a DRAFT diagnosis in place', async () => {
      prisma.diagnosis.findUnique.mockResolvedValue(draftDiagnosis);

      const result = await service.update('diagnosis-1', { description: 'revised' }, actor);
      expect(result.description).toBe('revised');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DIAGNOSIS_UPDATED' }),
      );
    });
  });

  describe('finalize', () => {
    it('rejects finalizing a diagnosis that is not DRAFT', async () => {
      prisma.diagnosis.findUnique.mockResolvedValue({ ...draftDiagnosis, status: 'FINALIZED' });

      await expect(service.finalize('diagnosis-1', actor)).rejects.toMatchObject({
        code: 'DIAGNOSIS_NOT_DRAFT',
      });
    });

    it('finalizes a DRAFT diagnosis', async () => {
      prisma.diagnosis.findUnique.mockResolvedValue(draftDiagnosis);

      const result = await service.finalize('diagnosis-1', actor);
      expect(result.status).toBe('FINALIZED');
      expect(result.finalizedAt).toBeInstanceOf(Date);
    });
  });

  describe('amend', () => {
    it('rejects amending a diagnosis that is not FINALIZED', async () => {
      prisma.diagnosis.findUnique.mockResolvedValue(draftDiagnosis);

      await expect(
        service.amend('diagnosis-1', { description: 'corrected' }, actor),
      ).rejects.toMatchObject({ code: 'DIAGNOSIS_NOT_FINALIZED' });
    });

    it('marks the original AMENDED and creates a new DRAFT referencing it', async () => {
      const finalized = { ...draftDiagnosis, status: 'FINALIZED', finalizedAt: new Date() };
      prisma.diagnosis.findUnique.mockResolvedValue(finalized);

      const result = await service.amend('diagnosis-1', { description: 'corrected' }, actor);

      expect(prisma.diagnosis.update).toHaveBeenCalledWith({
        where: { id: 'diagnosis-1' },
        data: { status: 'AMENDED' },
      });
      expect(prisma.diagnosis.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amendedFromId: 'diagnosis-1', description: 'corrected' }),
      });
      expect(result.amendedFromId).toBe('diagnosis-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DIAGNOSIS_AMENDED' }),
      );
    });
  });
});
