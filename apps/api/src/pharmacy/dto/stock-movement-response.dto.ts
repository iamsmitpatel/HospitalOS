import { ApiProperty } from '@nestjs/swagger';
import { StockMovementType } from '@prisma/client';

export class StockMovementResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() medicineId!: string;
  @ApiProperty() stockBatchId!: string;
  @ApiProperty({ enum: StockMovementType }) type!: StockMovementType;
  @ApiProperty() quantityDelta!: number;
  @ApiProperty({ nullable: true }) referenceType!: string | null;
  @ApiProperty({ nullable: true }) referenceId!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty() createdByUserId!: string;
  @ApiProperty() createdAt!: Date;
}
