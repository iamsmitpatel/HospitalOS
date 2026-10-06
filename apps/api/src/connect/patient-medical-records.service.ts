import { Injectable } from '@nestjs/common';
import {
  Diagnosis,
  Encounter,
  LabOrder,
  LabOrderItem,
  LabResult,
  LabTest,
  Prescription,
  PrescriptionItem,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import {
  PatientDiagnosisResponseDto,
  PatientEncounterDetailResponseDto,
  PatientEncounterResponseDto,
  PatientInvoiceResponseDto,
  PatientLabOrderResponseDto,
  PatientPrescriptionResponseDto,
} from './dto/patient-medical-record-response.dto';

// A DRAFT diagnosis/prescription is a clinician's in-progress note, not yet
// committed — never surfaced to the patient as a finalized fact. CANCELLED
// never happened. Only FINALIZED/AMENDED (a record that WAS finalized, later
// superseded) are shown. See patient-medical-record-response.dto.ts for the
// equivalent lab-result-verification rule.
const PATIENT_VISIBLE_DIAGNOSIS_STATUSES = ['FINALIZED', 'AMENDED'];
const PATIENT_VISIBLE_PRESCRIPTION_STATUSES = ['FINALIZED', 'AMENDED'];
const PATIENT_VISIBLE_LAB_RESULT_STATUSES = ['VERIFIED', 'AMENDED'];
const PATIENT_HIDDEN_INVOICE_STATUSES = ['DRAFT'];

type PrescriptionWithItems = Prescription & { items: PrescriptionItem[] };
type LabOrderWithItems = LabOrder & {
  items: (LabOrderItem & { labTest: LabTest; result: LabResult | null })[];
};

/**
 * Read-only patient-facing medical record. Deliberately NOT added as
 * methods on EncountersService/PrescriptionsService/LabOrdersService/
 * InvoicesService: those are staff-actor-centric (tenant+permission
 * checked, mutating). This is a separate query surface, same reasoning as
 * patient-queue.service.ts — keeps the patient-safety visibility rules
 * (no DRAFT clinical data, no unverified lab values) from ever being
 * weakened by a future staff-side change to those services.
 */
@Injectable()
export class PatientMedicalRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientsService: PatientsService,
  ) {}

  async listEncounters(
    patientId: string,
    connectUserId: string,
  ): Promise<PatientEncounterResponseDto[]> {
    await this.patientsService.getOwnPatientRecordOrThrow(patientId, connectUserId);
    const encounters = await this.prisma.encounter.findMany({
      where: { patientId },
      orderBy: { startedAt: 'desc' },
    });
    return encounters.map((e) => this.toEncounterResponse(e));
  }

  async getEncounterDetail(
    patientId: string,
    encounterId: string,
    connectUserId: string,
  ): Promise<PatientEncounterDetailResponseDto | null> {
    await this.patientsService.getOwnPatientRecordOrThrow(patientId, connectUserId);
    const encounter = await this.prisma.encounter.findFirst({
      where: { id: encounterId, patientId },
    });
    if (!encounter) {
      return null;
    }

    const [vitalSigns, clinicalNotes, diagnoses, prescriptions, labOrders] = await Promise.all([
      this.prisma.vitalSigns.findMany({ where: { encounterId }, orderBy: { recordedAt: 'desc' } }),
      this.prisma.clinicalNote.findMany({ where: { encounterId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.diagnosis.findMany({ where: { encounterId } }),
      this.prisma.prescription.findMany({ where: { encounterId }, include: { items: true } }),
      this.prisma.labOrder.findMany({
        where: { encounterId },
        include: { items: { include: { labTest: true, result: true } } },
      }),
    ]);

    return {
      ...this.toEncounterResponse(encounter),
      vitalSigns: vitalSigns.map((v) => ({
        id: v.id,
        bloodPressureSystolic: v.bloodPressureSystolic,
        bloodPressureDiastolic: v.bloodPressureDiastolic,
        heartRateBpm: v.heartRateBpm,
        temperatureCelsius: v.temperatureCelsius?.toString() ?? null,
        respiratoryRate: v.respiratoryRate,
        oxygenSaturationPercent: v.oxygenSaturationPercent,
        weightKg: v.weightKg?.toString() ?? null,
        heightCm: v.heightCm?.toString() ?? null,
        recordedAt: v.recordedAt,
      })),
      clinicalNotes: clinicalNotes.map((n) => ({
        id: n.id,
        chiefComplaint: n.chiefComplaint,
        history: n.history,
        examination: n.examination,
        assessment: n.assessment,
        plan: n.plan,
        createdAt: n.createdAt,
      })),
      diagnoses: diagnoses
        .filter((d) => PATIENT_VISIBLE_DIAGNOSIS_STATUSES.includes(d.status))
        .map((d) => this.toDiagnosisResponse(d)),
      prescriptions: prescriptions
        .filter((p) => PATIENT_VISIBLE_PRESCRIPTION_STATUSES.includes(p.status))
        .map((p) => this.toPrescriptionResponse(p)),
      labOrders: labOrders.map((o) => this.toLabOrderResponse(o)),
    };
  }

  async listPrescriptions(
    patientId: string,
    connectUserId: string,
  ): Promise<PatientPrescriptionResponseDto[]> {
    await this.patientsService.getOwnPatientRecordOrThrow(patientId, connectUserId);
    const prescriptions = await this.prisma.prescription.findMany({
      where: {
        patientId,
        status: { in: PATIENT_VISIBLE_PRESCRIPTION_STATUSES as Prescription['status'][] },
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    return prescriptions.map((p) => this.toPrescriptionResponse(p));
  }

  async listLabOrders(
    patientId: string,
    connectUserId: string,
  ): Promise<PatientLabOrderResponseDto[]> {
    await this.patientsService.getOwnPatientRecordOrThrow(patientId, connectUserId);
    const labOrders = await this.prisma.labOrder.findMany({
      where: { patientId },
      include: { items: { include: { labTest: true, result: true } } },
      orderBy: { orderedAt: 'desc' },
    });
    return labOrders.map((o) => this.toLabOrderResponse(o));
  }

  async listInvoices(
    patientId: string,
    connectUserId: string,
  ): Promise<PatientInvoiceResponseDto[]> {
    await this.patientsService.getOwnPatientRecordOrThrow(patientId, connectUserId);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        patientId,
        status: { notIn: PATIENT_HIDDEN_INVOICE_STATUSES as PatientInvoiceResponseDto['status'][] },
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map((inv) => ({
      id: inv.id,
      encounterId: inv.encounterId,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      subtotal: inv.subtotal.toString(),
      discountAmount: inv.discountAmount.toString(),
      taxAmount: inv.taxAmount.toString(),
      total: inv.total.toString(),
      amountPaid: inv.amountPaid.toString(),
      amountRefunded: inv.amountRefunded.toString(),
      currency: inv.currency,
      issuedAt: inv.issuedAt,
      items: inv.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        discountAmount: item.discountAmount.toString(),
        lineTotal: item.lineTotal.toString(),
      })),
    }));
  }

  private toEncounterResponse(encounter: Encounter): PatientEncounterResponseDto {
    return {
      id: encounter.id,
      hospitalId: encounter.hospitalId,
      doctorProfileId: encounter.doctorProfileId,
      departmentId: encounter.departmentId,
      status: encounter.status,
      startedAt: encounter.startedAt,
      endedAt: encounter.endedAt,
    };
  }

  private toDiagnosisResponse(diagnosis: Diagnosis): PatientDiagnosisResponseDto {
    return {
      id: diagnosis.id,
      description: diagnosis.description,
      diagnosisCode: diagnosis.diagnosisCode,
      type: diagnosis.type,
      status: diagnosis.status,
      finalizedAt: diagnosis.finalizedAt,
    };
  }

  private toPrescriptionResponse(
    prescription: PrescriptionWithItems,
  ): PatientPrescriptionResponseDto {
    return {
      id: prescription.id,
      encounterId: prescription.encounterId,
      status: prescription.status,
      notes: prescription.notes,
      finalizedAt: prescription.finalizedAt,
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

  private toLabOrderResponse(labOrder: LabOrderWithItems): PatientLabOrderResponseDto {
    return {
      id: labOrder.id,
      encounterId: labOrder.encounterId,
      status: labOrder.status,
      orderedAt: labOrder.orderedAt,
      items: labOrder.items.map((item) => {
        const resultVisible =
          item.result && PATIENT_VISIBLE_LAB_RESULT_STATUSES.includes(item.result.status);
        return {
          id: item.id,
          labTestId: item.labTestId,
          labTestName: item.labTest.name,
          status: item.status,
          collectedAt: item.collectedAt,
          result: resultVisible
            ? {
                value: item.result!.value,
                unit: item.result!.unit,
                referenceRange: item.result!.referenceRange,
                flag: item.result!.flag,
                status: item.result!.status,
                verifiedAt: item.result!.verifiedAt,
              }
            : null,
        };
      }),
    };
  }
}
