import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateRefundDto {
  @ApiProperty()
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ required: false, description: 'The specific payment being refunded, if known.' })
  @IsOptional()
  @IsUUID()
  paymentId?: string;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
