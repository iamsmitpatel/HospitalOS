import { ApiProperty } from '@nestjs/swagger';

export class LabTestResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ nullable: true }) category!: string | null;
  @ApiProperty({ nullable: true }) sampleType!: string | null;
  @ApiProperty({ nullable: true }) unit!: string | null;
  @ApiProperty({ nullable: true }) referenceRangeLow!: string | null;
  @ApiProperty({ nullable: true }) referenceRangeHigh!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
}
