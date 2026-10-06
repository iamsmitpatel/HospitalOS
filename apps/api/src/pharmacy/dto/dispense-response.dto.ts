import { ApiProperty } from '@nestjs/swagger';

export class DispenseResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() prescriptionItemId!: string;
  @ApiProperty() stockBatchId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() dispensedByUserId!: string;
  @ApiProperty() dispensedAt!: Date;
}
