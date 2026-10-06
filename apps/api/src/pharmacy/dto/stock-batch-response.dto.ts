import { ApiProperty } from '@nestjs/swagger';
import { StockBatchStatus } from '@prisma/client';

export class StockBatchResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() medicineId!: string;
  @ApiProperty() batchNumber!: string;
  @ApiProperty() quantityReceived!: number;
  @ApiProperty() quantityRemaining!: number;
  @ApiProperty() expiryDate!: Date;
  @ApiProperty({ nullable: true }) purchasePrice!: string | null;
  @ApiProperty({ enum: StockBatchStatus }) status!: StockBatchStatus;
  @ApiProperty() receivedAt!: Date;
  @ApiProperty() createdByUserId!: string;
}
