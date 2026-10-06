import { Injectable } from '@nestjs/common';
import { AuditOutcome, VitalSigns } from '@prisma/client';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { EncountersService, assertEncounterNotCancelled } from './encounters.service';
import { CreateVitalsDto } from './dto/create-vitals.dto';
import { VitalsResponseDto } from './dto/vitals-response.dto';

@Injectable()
export class VitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly encountersService: EncountersService,
  ) {}

  async create(
    encounterId: string,
    dto: CreateVitalsDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<VitalsResponseDto> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    assertEncounterNotCancelled(encounter);

    const vitals = await this.prisma.vitalSigns.create({
      data: {
        hospitalId: encounter.hospitalId,
        encounterId: encounter.id,
        patientId: encounter.patientId,
        bloodPressureSystolic: dto.bloodPressureSystolic,
        bloodPressureDiastolic: dto.bloodPressureDiastolic,
        heartRateBpm: dto.heartRateBpm,
        temperatureCelsius: dto.temperatureCelsius,
        respiratoryRate: dto.respiratoryRate,
        oxygenSaturationPercent: dto.oxygenSaturationPercent,
        weightKg: dto.weightKg,
        heightCm: dto.heightCm,
        recordedByUserId: actor.userId,
      },
    });

    await this.auditService.log({
      action: AuditAction.VITALS_RECORDED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'VitalSigns',
      resourceId: vitals.id,
      correlationId,
    });

    return this.toResponse(vitals);
  }

  async listForEncounter(
    encounterId: string,
    actor: AuthenticatedUser,
  ): Promise<VitalsResponseDto[]> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    const items = await this.prisma.vitalSigns.findMany({
      where: { encounterId: encounter.id },
      orderBy: { recordedAt: 'desc' },
    });
    return items.map((v) => this.toResponse(v));
  }

  private toResponse(vitals: VitalSigns): VitalsResponseDto {
    return {
      id: vitals.id,
      hospitalId: vitals.hospitalId,
      encounterId: vitals.encounterId,
      patientId: vitals.patientId,
      bloodPressureSystolic: vitals.bloodPressureSystolic,
      bloodPressureDiastolic: vitals.bloodPressureDiastolic,
      heartRateBpm: vitals.heartRateBpm,
      temperatureCelsius: vitals.temperatureCelsius?.toString() ?? null,
      respiratoryRate: vitals.respiratoryRate,
      oxygenSaturationPercent: vitals.oxygenSaturationPercent,
      weightKg: vitals.weightKg?.toString() ?? null,
      heightCm: vitals.heightCm?.toString() ?? null,
      recordedByUserId: vitals.recordedByUserId,
      recordedAt: vitals.recordedAt,
      createdAt: vitals.createdAt,
    };
  }
}
