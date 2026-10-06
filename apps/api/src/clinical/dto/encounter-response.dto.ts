import { ApiProperty } from '@nestjs/swagger';
import { EncounterStatus } from '@prisma/client';

export class EncounterResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() doctorProfileId!: string;
  @ApiProperty() departmentId!: string;
  @ApiProperty({ nullable: true }) appointmentId!: string | null;
  @ApiProperty({ enum: EncounterStatus }) status!: EncounterStatus;
  @ApiProperty() startedAt!: Date;
  @ApiProperty({ nullable: true }) endedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class PaginatedEncountersResponseDto {
  @ApiProperty({ type: [EncounterResponseDto] }) items!: EncounterResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
