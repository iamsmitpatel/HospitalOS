import { ApiProperty } from '@nestjs/swagger';
import { DiagnosisStatus } from '@prisma/client';

export class DiagnosisResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true }) diagnosisCode!: string | null;
  @ApiProperty({ nullable: true }) type!: string | null;
  @ApiProperty({ enum: DiagnosisStatus }) status!: DiagnosisStatus;
  @ApiProperty() recordedByUserId!: string;
  @ApiProperty() recordedAt!: Date;
  @ApiProperty({ nullable: true }) finalizedAt!: Date | null;
  @ApiProperty({ nullable: true }) amendedFromId!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class PaginatedDiagnosesResponseDto {
  @ApiProperty({ type: [DiagnosisResponseDto] }) items!: DiagnosisResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
