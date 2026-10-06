import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, ClinicalNote } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { EncountersService, assertEncounterNotCancelled } from './encounters.service';
import { CreateClinicalNoteDto } from './dto/create-clinical-note.dto';
import { ClinicalNoteResponseDto } from './dto/clinical-note-response.dto';

@Injectable()
export class ClinicalNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly encountersService: EncountersService,
  ) {}

  async create(
    encounterId: string,
    dto: CreateClinicalNoteDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<ClinicalNoteResponseDto> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    assertEncounterNotCancelled(encounter);

    if (!dto.chiefComplaint && !dto.history && !dto.examination && !dto.assessment && !dto.plan) {
      throw new AppException(
        'EMPTY_CLINICAL_NOTE',
        'A clinical note must contain at least one section.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.correctsId) {
      const original = await this.prisma.clinicalNote.findUnique({
        where: { id: dto.correctsId },
      });
      if (!original || original.encounterId !== encounter.id) {
        throw new AppException(
          'CLINICAL_NOTE_NOT_FOUND',
          'The note being corrected was not found on this encounter.',
          HttpStatus.NOT_FOUND,
        );
      }
      const alreadyCorrected = await this.prisma.clinicalNote.findUnique({
        where: { correctsId: dto.correctsId },
      });
      if (alreadyCorrected) {
        throw new AppException(
          'CLINICAL_NOTE_ALREADY_CORRECTED',
          'This note has already been corrected by a later note. Correct the latest one instead.',
          HttpStatus.CONFLICT,
        );
      }
    }

    const note = await this.prisma.clinicalNote.create({
      data: {
        hospitalId: encounter.hospitalId,
        encounterId: encounter.id,
        patientId: encounter.patientId,
        chiefComplaint: dto.chiefComplaint,
        history: dto.history,
        examination: dto.examination,
        assessment: dto.assessment,
        plan: dto.plan,
        authorUserId: actor.userId,
        correctsId: dto.correctsId,
      },
    });

    await this.auditService.log({
      action: AuditAction.CLINICAL_NOTE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'ClinicalNote',
      resourceId: note.id,
      correlationId,
    });

    return this.toResponse(note);
  }

  async listForEncounter(
    encounterId: string,
    actor: AuthenticatedUser,
  ): Promise<ClinicalNoteResponseDto[]> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    const items = await this.prisma.clinicalNote.findMany({
      where: { encounterId: encounter.id },
      orderBy: { createdAt: 'asc' },
    });
    return items.map((n) => this.toResponse(n));
  }

  private toResponse(note: ClinicalNote): ClinicalNoteResponseDto {
    return {
      id: note.id,
      hospitalId: note.hospitalId,
      encounterId: note.encounterId,
      patientId: note.patientId,
      chiefComplaint: note.chiefComplaint,
      history: note.history,
      examination: note.examination,
      assessment: note.assessment,
      plan: note.plan,
      authorUserId: note.authorUserId,
      correctsId: note.correctsId,
      createdAt: note.createdAt,
    };
  }
}
