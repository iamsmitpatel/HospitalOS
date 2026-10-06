import { ApiProperty } from '@nestjs/swagger';
import { PrescriptionStatus } from '@prisma/client';

export class PrescriptionItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() medicineId!: string;
  @ApiProperty() dosage!: string;
  @ApiProperty() frequency!: string;
  @ApiProperty() duration!: string;
  @ApiProperty({ nullable: true }) route!: string | null;
  @ApiProperty({ nullable: true }) instructions!: string | null;
  @ApiProperty() quantity!: number;
}

export class PrescriptionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() doctorProfileId!: string;
  @ApiProperty({ enum: PrescriptionStatus }) status!: PrescriptionStatus;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ nullable: true }) amendedFromId!: string | null;
  @ApiProperty() createdByUserId!: string;
  @ApiProperty({ nullable: true }) finalizedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: [PrescriptionItemResponseDto] }) items!: PrescriptionItemResponseDto[];
}

export class PaginatedPrescriptionsResponseDto {
  @ApiProperty({ type: [PrescriptionResponseDto] }) items!: PrescriptionResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
