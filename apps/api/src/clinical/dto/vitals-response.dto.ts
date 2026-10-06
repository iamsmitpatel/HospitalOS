import { ApiProperty } from '@nestjs/swagger';

export class VitalsResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty({ nullable: true }) bloodPressureSystolic!: number | null;
  @ApiProperty({ nullable: true }) bloodPressureDiastolic!: number | null;
  @ApiProperty({ nullable: true }) heartRateBpm!: number | null;
  @ApiProperty({ nullable: true }) temperatureCelsius!: string | null;
  @ApiProperty({ nullable: true }) respiratoryRate!: number | null;
  @ApiProperty({ nullable: true }) oxygenSaturationPercent!: number | null;
  @ApiProperty({ nullable: true }) weightKg!: string | null;
  @ApiProperty({ nullable: true }) heightCm!: string | null;
  @ApiProperty() recordedByUserId!: string;
  @ApiProperty() recordedAt!: Date;
  @ApiProperty() createdAt!: Date;
}
