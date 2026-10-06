import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Prescription, PrescriptionItem } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenantStrict } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { EncountersService, assertEncounterNotCancelled } from './encounters.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { PrescriptionItemDto } from './dto/prescription-item.dto';
import { PrescriptionResponseDto } from './dto/prescription-response.dto';

type PrescriptionWithItems = Prescription & { items: PrescriptionItem[] };

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly encountersService: EncountersService,
  ) {}

  async create(
    encounterId: string,
    dto: CreatePrescriptionDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<PrescriptionResponseDto> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    assertEncounterNotCancelled(encounter);
    const doctor = await this.encountersService.assertOwnEncounter(encounter, actor);
    await this.validateItems(dto.items, encounter.hospitalId);

    const prescription = await this.prisma.prescription.create({
      data: {
        hospitalId: encounter.hospitalId,
        encounterId: encounter.id,
        patientId: encounter.patientId,
        doctorProfileId: doctor.id,
        notes: dto.notes,
        createdByUserId: actor.userId,
        items: { create: dto.items.map((item) => this.toItemCreateInput(item)) },
      },
      include: { items: true },
    });

    await this.auditService.log({
      action: AuditAction.PRESCRIPTION_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'Prescription',
      resourceId: prescription.id,
      correlationId,
    });

    return this.toResponse(prescription);
  }

  async update(
    id: string,
    dto: UpdatePrescriptionDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<PrescriptionResponseDto> {
    const prescription = await this.getTenantScopedPrescriptionOrThrow(id, actor);
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      prescription.encounterId,
      actor,
    );
    await this.encountersService.assertOwnEncounter(encounter, actor);

    if (prescription.status !== 'DRAFT') {
      throw new AppException(
        'PRESCRIPTION_NOT_DRAFT',
        `Cannot edit a prescription in status ${prescription.status}. Use amend instead.`,
        HttpStatus.CONFLICT,
      );
    }

    if (dto.items) {
      await this.validateItems(dto.items, prescription.hospitalId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.prescriptionItem.deleteMany({ where: { prescriptionId: prescription.id } });
      }
      return tx.prescription.update({
        where: { id: prescription.id },
        data: {
          notes: dto.notes,
          ...(dto.items
            ? { items: { create: dto.items.map((item) => this.toItemCreateInput(item)) } }
            : {}),
        },
        include: { items: true },
      });
    });

    await this.auditService.log({
      action: AuditAction.PRESCRIPTION_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'Prescription',
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
  ): Promise<PrescriptionResponseDto> {
    const prescription = await this.getTenantScopedPrescriptionOrThrow(id, actor);
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      prescription.encounterId,
      actor,
    );
    await this.encountersService.assertOwnEncounter(encounter, actor);

    if (prescription.status !== 'DRAFT') {
      throw new AppException(
        'PRESCRIPTION_NOT_DRAFT',
        `Cannot finalize a prescription in status ${prescription.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.prescription.update({
      where: { id: prescription.id },
      data: { status: 'FINALIZED', finalizedAt: new Date() },
      include: { items: true },
    });

    await this.auditService.log({
      action: AuditAction.PRESCRIPTION_FINALIZED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'Prescription',
      resourceId: updated.id,
      correlationId,
    });

    return this.toResponse(updated);
  }

  /** Amendment-chain pattern, same as diagnoses.service.ts amend() — see there for the full rationale. */
  async amend(
    id: string,
    dto: CreatePrescriptionDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<PrescriptionResponseDto> {
    const original = await this.getTenantScopedPrescriptionOrThrow(id, actor);
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      original.encounterId,
      actor,
    );
    await this.encountersService.assertOwnEncounter(encounter, actor);

    if (original.status !== 'FINALIZED') {
      throw new AppException(
        'PRESCRIPTION_NOT_FINALIZED',
        'Only a finalized prescription can be amended.',
        HttpStatus.CONFLICT,
      );
    }
    await this.validateItems(dto.items, original.hospitalId);

    const amended = await this.prisma.$transaction(async (tx) => {
      await tx.prescription.update({ where: { id: original.id }, data: { status: 'AMENDED' } });
      return tx.prescription.create({
        data: {
          hospitalId: original.hospitalId,
          encounterId: original.encounterId,
          patientId: original.patientId,
          doctorProfileId: original.doctorProfileId,
          notes: dto.notes,
          createdByUserId: actor.userId,
          amendedFromId: original.id,
          items: { create: dto.items.map((item) => this.toItemCreateInput(item)) },
        },
        include: { items: true },
      });
    });

    await this.auditService.log({
      action: AuditAction.PRESCRIPTION_AMENDED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: encounter.hospitalId,
      resourceType: 'Prescription',
      resourceId: amended.id,
      correlationId,
      metadata: { amendedFromId: original.id },
    });

    return this.toResponse(amended);
  }

  async listForEncounter(
    encounterId: string,
    actor: AuthenticatedUser,
  ): Promise<PrescriptionResponseDto[]> {
    const encounter = await this.encountersService.getTenantScopedEncounterOrThrow(
      encounterId,
      actor,
    );
    const items = await this.prisma.prescription.findMany({
      where: { encounterId: encounter.id },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((p) => this.toResponse(p));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<PrescriptionResponseDto> {
    const prescription = await this.getTenantScopedPrescriptionOrThrow(id, actor);
    return this.toResponse(prescription);
  }

  /** Public so pharmacy.* services (Phase 4) can validate a prescription reference for dispensing without duplicating this check. */
  async getTenantScopedPrescriptionOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PrescriptionWithItems> {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!prescription) {
      throw new AppException(
        'PRESCRIPTION_NOT_FOUND',
        'Prescription not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    assertSameTenantStrict(
      prescription.hospitalId,
      actor,
      'PRESCRIPTION_NOT_FOUND',
      'Prescription not found.',
    );
    return prescription;
  }

  /**
   * Medicine catalog validation via direct Prisma access rather than a
   * PharmacyModule dependency — the pharmacy module (catalog management)
   * does not exist yet at this point in the build-out, and a prescription
   * only needs to confirm a medicine reference is real/active/same-tenant,
   * not anything pharmacy-operational. See /DECISIONS.md.
   */
  private async validateItems(items: PrescriptionItemDto[], hospitalId: string): Promise<void> {
    const medicineIds = [...new Set(items.map((item) => item.medicineId))];
    const medicines = await this.prisma.medicine.findMany({
      where: { id: { in: medicineIds }, hospitalId },
    });
    const byId = new Map(medicines.map((m) => [m.id, m]));
    for (const medicineId of medicineIds) {
      const medicine = byId.get(medicineId);
      if (!medicine) {
        throw new AppException(
          'MEDICINE_NOT_FOUND',
          `Medicine ${medicineId} not found.`,
          HttpStatus.NOT_FOUND,
        );
      }
      if (!medicine.isActive) {
        throw new AppException(
          'MEDICINE_INACTIVE',
          `Medicine ${medicine.name} is inactive and cannot be prescribed.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private toItemCreateInput(item: PrescriptionItemDto) {
    return {
      medicineId: item.medicineId,
      dosage: item.dosage,
      frequency: item.frequency,
      duration: item.duration,
      route: item.route,
      instructions: item.instructions,
      quantity: item.quantity,
    };
  }

  private toResponse(prescription: PrescriptionWithItems): PrescriptionResponseDto {
    return {
      id: prescription.id,
      hospitalId: prescription.hospitalId,
      encounterId: prescription.encounterId,
      patientId: prescription.patientId,
      doctorProfileId: prescription.doctorProfileId,
      status: prescription.status,
      notes: prescription.notes,
      amendedFromId: prescription.amendedFromId,
      createdByUserId: prescription.createdByUserId,
      finalizedAt: prescription.finalizedAt,
      createdAt: prescription.createdAt,
      updatedAt: prescription.updatedAt,
      items: prescription.items.map((item) => ({
        id: item.id,
        medicineId: item.medicineId,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        route: item.route,
        instructions: item.instructions,
        quantity: item.quantity,
      })),
    };
  }
}
