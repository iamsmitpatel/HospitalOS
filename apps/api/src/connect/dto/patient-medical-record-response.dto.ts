import { ApiProperty } from '@nestjs/swagger';
import {
  DiagnosisStatus,
  EncounterStatus,
  InvoiceStatus,
  LabOrderItemStatus,
  LabOrderStatus,
  LabResultFlag,
  LabResultStatus,
  PrescriptionStatus,
} from '@prisma/client';

export class PatientEncounterResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() doctorProfileId!: string;
  @ApiProperty() departmentId!: string;
  @ApiProperty({ enum: EncounterStatus }) status!: EncounterStatus;
  @ApiProperty() startedAt!: Date;
  @ApiProperty({ nullable: true }) endedAt!: Date | null;
}

export class PatientVitalsResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) bloodPressureSystolic!: number | null;
  @ApiProperty({ nullable: true }) bloodPressureDiastolic!: number | null;
  @ApiProperty({ nullable: true }) heartRateBpm!: number | null;
  @ApiProperty({ nullable: true }) temperatureCelsius!: string | null;
  @ApiProperty({ nullable: true }) respiratoryRate!: number | null;
  @ApiProperty({ nullable: true }) oxygenSaturationPercent!: number | null;
  @ApiProperty({ nullable: true }) weightKg!: string | null;
  @ApiProperty({ nullable: true }) heightCm!: string | null;
  @ApiProperty() recordedAt!: Date;
}

export class PatientClinicalNoteResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) chiefComplaint!: string | null;
  @ApiProperty({ nullable: true }) history!: string | null;
  @ApiProperty({ nullable: true }) examination!: string | null;
  @ApiProperty({ nullable: true }) assessment!: string | null;
  @ApiProperty({ nullable: true }) plan!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class PatientDiagnosisResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true }) diagnosisCode!: string | null;
  @ApiProperty({ nullable: true }) type!: string | null;
  @ApiProperty({ enum: DiagnosisStatus }) status!: DiagnosisStatus;
  @ApiProperty({ nullable: true }) finalizedAt!: Date | null;
}

export class PatientPrescriptionItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() medicineId!: string;
  @ApiProperty() dosage!: string;
  @ApiProperty() frequency!: string;
  @ApiProperty() duration!: string;
  @ApiProperty({ nullable: true }) route!: string | null;
  @ApiProperty({ nullable: true }) instructions!: string | null;
  @ApiProperty() quantity!: number;
}

export class PatientPrescriptionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty({ enum: PrescriptionStatus }) status!: PrescriptionStatus;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ nullable: true }) finalizedAt!: Date | null;
  @ApiProperty({ type: [PatientPrescriptionItemResponseDto] })
  items!: PatientPrescriptionItemResponseDto[];
}

/**
 * A lab result is withheld (null) until a clinician has VERIFIED it — an
 * ENTERED/REVIEWED value may still be an entry error or a preliminary read,
 * and showing it to the patient as fact before sign-off is a patient-safety
 * risk, not just a formatting choice. See patient-medical-records.service.ts.
 */
export class PatientLabResultResponseDto {
  @ApiProperty() value!: string;
  @ApiProperty({ nullable: true }) unit!: string | null;
  @ApiProperty({ nullable: true }) referenceRange!: string | null;
  @ApiProperty({ enum: LabResultFlag, nullable: true }) flag!: LabResultFlag | null;
  @ApiProperty({ enum: LabResultStatus }) status!: LabResultStatus;
  @ApiProperty({ nullable: true }) verifiedAt!: Date | null;
}

export class PatientLabOrderItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() labTestId!: string;
  @ApiProperty() labTestName!: string;
  @ApiProperty({ enum: LabOrderItemStatus }) status!: LabOrderItemStatus;
  @ApiProperty({ nullable: true }) collectedAt!: Date | null;
  @ApiProperty({ type: PatientLabResultResponseDto, nullable: true })
  result!: PatientLabResultResponseDto | null;
}

export class PatientLabOrderResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty({ enum: LabOrderStatus }) status!: LabOrderStatus;
  @ApiProperty() orderedAt!: Date;
  @ApiProperty({ type: [PatientLabOrderItemResponseDto] }) items!: PatientLabOrderItemResponseDto[];
}

export class PatientInvoiceItemResponseDto {
  @ApiProperty() description!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: string;
  @ApiProperty() discountAmount!: string;
  @ApiProperty() lineTotal!: string;
}

export class PatientInvoiceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) encounterId!: string | null;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty({ enum: InvoiceStatus }) status!: InvoiceStatus;
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountAmount!: string;
  @ApiProperty() taxAmount!: string;
  @ApiProperty() total!: string;
  @ApiProperty() amountPaid!: string;
  @ApiProperty() amountRefunded!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true }) issuedAt!: Date | null;
  @ApiProperty({ type: [PatientInvoiceItemResponseDto] }) items!: PatientInvoiceItemResponseDto[];
}

export class PatientEncounterDetailResponseDto extends PatientEncounterResponseDto {
  @ApiProperty({ type: [PatientVitalsResponseDto] }) vitalSigns!: PatientVitalsResponseDto[];
  @ApiProperty({ type: [PatientClinicalNoteResponseDto] })
  clinicalNotes!: PatientClinicalNoteResponseDto[];
  @ApiProperty({ type: [PatientDiagnosisResponseDto] }) diagnoses!: PatientDiagnosisResponseDto[];
  @ApiProperty({ type: [PatientPrescriptionResponseDto] })
  prescriptions!: PatientPrescriptionResponseDto[];
  @ApiProperty({ type: [PatientLabOrderResponseDto] }) labOrders!: PatientLabOrderResponseDto[];
}
