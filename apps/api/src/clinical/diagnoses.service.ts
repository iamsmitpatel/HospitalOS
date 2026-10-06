import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Diagnosis } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { EncountersService, assertEncounterNotCancelled } from './encounters.service';
import { CreateDiagnosisDto } from './dto/create-diagnosis.dto';
import { UpdateDiagnosisDto } from './dto/update-diagnosis.dto';
import { DiagnosisResponseDto } from './dto/diagnosis-response.dto';

@Injectable()
export class DiagnosesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly encountersService: EncountersService,
  ) {}

  async create(
    encounterId: string,
    dto: CreateDiagnosisDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<DiagnosisResponseDto> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    assertEncounterNotCancelled(encounter);
    await this.encountersService.assertOwnEncounter(encounter, actor);

    const diagnosis = await this.prisma.diagnosis.create({
      data: {
        hospitalId: encounter.hospitalId,
        encounterId: encounter.id,
        patientId: encounter.patientId,
        description: dto.description,
        diagnosisCode: dto.diagnosisCode,
        type: dto.type,
        recordedByUserId: actor.userId,
      },
    });

    await this.auditService.log({
      action: AuditAction.DIAGNOSIS_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'Diagnosis',
      resourceId: diagnosis.id,
      correlationId,
    });

    return this.toResponse(diagnosis);
  }

  async update(
    id: string,
    dto: UpdateDiagnosisDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<DiagnosisResponseDto> {
    const diagnosis = await this.getTenantScopedDiagnosisOrThrow(id, actor);
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      diagnosis.encounterId,
      actor,
    );
    await this.encountersService.assertOwnEncounter(encounter, actor);

    if (diagnosis.status !== 'DRAFT') {
      throw new AppException(
        'DIAGNOSIS_NOT_DRAFT',
        `Cannot edit a diagnosis in status ${diagnosis.status}. Use amend instead.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.diagnosis.update({
      where: { id: diagnosis.id },
      data: {
        description: dto.description,
        diagnosisCode: dto.diagnosisCode,
        type: dto.type,
      },
    });

    await this.auditService.log({
      action: AuditAction.DIAGNOSIS_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'Diagnosis',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  async finalize(
    id: string,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<DiagnosisResponseDto> {
    const diagnosis = await this.getTenantScopedDiagnosisOrThrow(id, actor);
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      diagnosis.encounterId,
      actor,
    );
    await this.encountersService.assertOwnEncounter(encounter, actor);

    if (diagnosis.status !== 'DRAFT') {
      throw new AppException(
        'DIAGNOSIS_NOT_DRAFT',
        `Cannot finalize a diagnosis in status ${diagnosis.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.diagnosis.update({
      where: { id: diagnosis.id },
      data: { status: 'FINALIZED', finalizedAt: new Date() },
    });

    await this.auditService.log({
      action: AuditAction.DIAGNOSIS_FINALIZED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'Diagnosis',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  /**
   * Amendment-chain pattern (master doc §16/§33, same as
   * Appointment.rescheduledFromId / Prescription.amendedFromId): a finalized
   * diagnosis is never edited in place. The old row is marked AMENDED and a
   * new DRAFT row is created pointing back at it — the new row goes through
   * its own finalize() call separately.
   */
  async amend(
    id: string,
    dto: CreateDiagnosisDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<DiagnosisResponseDto> {
    const original = await this.getTenantScopedDiagnosisOrThrow(id, actor);
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      original.encounterId,
      actor,
    );
    await this.encountersService.assertOwnEncounter(encounter, actor);

    if (original.status !== 'FINALIZED') {
      throw new AppException(
        'DIAGNOSIS_NOT_FINALIZED',
        'Only a finalized diagnosis can be amended.',
        HttpStatus.CONFLICT,
      );
    }

    const amended = await this.prisma.$transaction(async (tx) => {
      await tx.diagnosis.update({ where: { id: original.id }, data: { status: 'AMENDED' } });
      return tx.diagnosis.create({
        data: {
          hospitalId: original.hospitalId,
          encounterId: original.encounterId,
          patientId: original.patientId,
          description: dto.description,
          diagnosisCode: dto.diagnosisCode,
          type: dto.type,
          recordedByUserId: actor.userId,
          amendedFromId: original.id,
        },
      });
    });

    await this.auditService.log({
      action: AuditAction.DIAGNOSIS_AMENDED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'Diagnosis',
      resourceId: amended.id,
      correlationId,
      metadata: { amendedFromId: original.id },
    });

    return this.toResponse(amended);
  }

  async listForEncounter(
    encounterId: string,
    actor: AuthenticatedUser,
  ): Promise<DiagnosisResponseDto[]> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    const items = await this.prisma.diagnosis.findMany({
      where: { encounterId: encounter.id },
      orderBy: { recordedAt: 'desc' },
    });
    return items.map((d) => this.toResponse(d));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<DiagnosisResponseDto> {
    const diagnosis = await this.getTenantScopedDiagnosisOrThrow(id, actor);
    return this.toResponse(diagnosis);
  }

  private async getTenantScopedDiagnosisOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Diagnosis> {
    const diagnosis = await this.prisma.diagnosis.findUnique({ where: { id } });
    if (!diagnosis) {
      throw new AppException('DIAGNOSIS_NOT_FOUND', 'Diagnosis not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenantStrict(
      diagnosis.hospitalId,
      actor,
      'DIAGNOSIS_NOT_FOUND',
      'Diagnosis not found.',
    );
    return diagnosis;
  }

  private toResponse(diagnosis: Diagnosis): DiagnosisResponseDto {
    return {
      id: diagnosis.id,
      hospitalId: diagnosis.hospitalId,
      encounterId: diagnosis.encounterId,
      patientId: diagnosis.patientId,
      description: diagnosis.description,
      diagnosisCode: diagnosis.diagnosisCode,
      type: diagnosis.type,
      status: diagnosis.status,
      recordedByUserId: diagnosis.recordedByUserId,
      recordedAt: diagnosis.recordedAt,
      finalizedAt: diagnosis.finalizedAt,
      amendedFromId: diagnosis.amendedFromId,
      createdAt: diagnosis.createdAt,
      updatedAt: diagnosis.updatedAt,
    };
  }
}
