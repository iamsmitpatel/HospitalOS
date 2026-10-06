import { Role } from '@prisma/client';
import { ClinicalNotesService } from './clinical-notes.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('ClinicalNotesService', () => {
  let prisma: any;
  let auditService: any;
  let encountersService: any;
  let service: ClinicalNotesService;

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
    status: 'IN_PROGRESS',
  };

  beforeEach(() => {
    prisma = {
      clinicalNote: {
        create: jest.fn((args: any) => ({ id: 'note-2', createdAt: new Date(), ...args.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    auditService = { log: jest.fn() };
    encountersService = {
      getTenantScopedEncounterOrThrow: jest.fn().mockResolvedValue(inProgressEncounter),
    };
    service = new ClinicalNotesService(prisma, auditService, encountersService);
  });

  it('rejects a note with no sections at all', async () => {
    await expect(service.create('encounter-1', {}, actor)).rejects.toMatchObject({
      code: 'EMPTY_CLINICAL_NOTE',
    });
  });

  it('rejects correcting a note that belongs to a different encounter', async () => {
    prisma.clinicalNote.findUnique.mockImplementation(({ where }: any) =>
      where.id === 'note-1' ? { id: 'note-1', encounterId: 'encounter-other' } : null,
    );

    await expect(
      service.create('encounter-1', { assessment: 'revised', correctsId: 'note-1' }, actor),
    ).rejects.toMatchObject({ code: 'CLINICAL_NOTE_NOT_FOUND' });
  });

  it('rejects correcting a note that has already been corrected', async () => {
    prisma.clinicalNote.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === 'note-1') return { id: 'note-1', encounterId: 'encounter-1' };
      if (where.correctsId === 'note-1') return { id: 'note-already-corrects-1' };
      return null;
    });

    await expect(
      service.create('encounter-1', { assessment: 'revised', correctsId: 'note-1' }, actor),
    ).rejects.toMatchObject({ code: 'CLINICAL_NOTE_ALREADY_CORRECTED' });
  });

  it('creates a note tied to the encounter and patient, and audits it', async () => {
    const result = await service.create(
      'encounter-1',
      { assessment: 'Stable, continue monitoring' },
      actor,
    );

    expect(prisma.clinicalNote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hospitalId: 'hospital-a',
        encounterId: 'encounter-1',
        patientId: 'patient-1',
        authorUserId: 'user-doctor-1',
      }),
    });
    expect(result.assessment).toBe('Stable, continue monitoring');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLINICAL_NOTE_CREATED' }),
    );
  });
});
