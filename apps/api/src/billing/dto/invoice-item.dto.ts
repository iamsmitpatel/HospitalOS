import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';

export class InvoiceItemDto {
  @ApiProperty({
    required: false,
    description: 'A catalog service to bill at its current price. Omit for a free-form charge.',
  })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiProperty({
    required: false,
    maxLength: 300,
    description: 'Required when serviceId is omitted; otherwise defaults to the service name.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description?: string;

  @ApiProperty({
    required: false,
    description: 'Required when serviceId is omitted — the catalog price is used otherwise.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  unitPrice?: number;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  quantity?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;
}
