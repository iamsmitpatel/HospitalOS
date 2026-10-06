import { ApiProperty } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';

export class InvoiceItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) serviceId!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: string;
  @ApiProperty() discountAmount!: string;
  @ApiProperty() lineTotal!: string;
}

export class InvoiceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty({ nullable: true }) encounterId!: string | null;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty({ enum: InvoiceStatus }) status!: InvoiceStatus;
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountAmount!: string;
  @ApiProperty() taxRate!: string;
  @ApiProperty() taxAmount!: string;
  @ApiProperty() total!: string;
  @ApiProperty() amountPaid!: string;
  @ApiProperty() amountRefunded!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true }) issuedAt!: Date | null;
  @ApiProperty() createdByUserId!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: [InvoiceItemResponseDto] }) items!: InvoiceItemResponseDto[];
}

export class PaginatedInvoicesResponseDto {
  @ApiProperty({ type: [InvoiceResponseDto] }) items!: InvoiceResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
