import { ApiProperty } from '@nestjs/swagger';
import { RefundStatus } from '@prisma/client';

export class RefundResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() invoiceId!: string;
  @ApiProperty({ nullable: true }) paymentId!: string | null;
  @ApiProperty() amount!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty({ enum: RefundStatus }) status!: RefundStatus;
  @ApiProperty() createdByUserId!: string;
  @ApiProperty() createdAt!: Date;
}
