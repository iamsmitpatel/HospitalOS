import { Role } from '@prisma/client';
import { VitalsService } from './vitals.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('VitalsService', () => {
  let prisma: any;
  let auditService: any;
  let encountersService: any;
  let service: VitalsService;

  const actor: AuthenticatedUser = {
    userId: 'user-nurse-1',
    email: 'nurse@hospitalos.dev',
    role: Role.NURSE,
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
      vitalSigns: {
        create: jest.fn((args: any) => ({
          id: 'vitals-1',
          recordedAt: new Date(),
          createdAt: new Date(),
          ...args.data,
        })),
        findMany: jest.fn(),
      },
    };
    auditService = { log: jest.fn() };
    encountersService = {
      getTenantScopedEncounterOrThrow: jest.fn().mockResolvedValue(inProgressEncounter),
    };
    service = new VitalsService(prisma, auditService, encountersService);
  });

  it('rejects recording vitals on a cancelled encounter', async () => {
    encountersService.getTenantScopedEncounterOrThrow.mockResolvedValue({
      ...inProgressEncounter,
      status: 'CANCELLED',
    });

    await expect(service.create('encounter-1', { heartRateBpm: 80 }, actor)).rejects.toMatchObject({
      code: 'ENCOUNTER_CANCELLED',
    });
  });

  it('records vitals tied to the encounter and patient, and audits it', async () => {
    const result = await service.create(
      'encounter-1',
      { heartRateBpm: 80, temperatureCelsius: 37.2 },
      actor,
    );

    expect(prisma.vitalSigns.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hospitalId: 'hospital-a',
        encounterId: 'encounter-1',
        patientId: 'patient-1',
        heartRateBpm: 80,
        recordedByUserId: 'user-nurse-1',
      }),
    });
    expect(result.heartRateBpm).toBe(80);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'VITALS_RECORDED' }),
    );
  });

  it('lists vitals for an encounter ordered most-recent-first', async () => {
    prisma.vitalSigns.findMany.mockResolvedValue([
      {
        id: 'vitals-1',
        hospitalId: 'hospital-a',
        encounterId: 'encounter-1',
        patientId: 'patient-1',
        recordedByUserId: 'user-nurse-1',
        recordedAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    const result = await service.listForEncounter('encounter-1', actor);
    expect(result).toHaveLength(1);
    expect(prisma.vitalSigns.findMany).toHaveBeenCalledWith({
      where: { encounterId: 'encounter-1' },
      orderBy: { recordedAt: 'desc' },
    });
  });
});
