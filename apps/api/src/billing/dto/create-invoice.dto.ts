import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { InvoiceItemDto } from './invoice-item.dto';

export class CreateInvoiceDto {
  @ApiProperty()
  @IsUUID()
  patientId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty({ type: [InvoiceItemDto] })
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  @ArrayMinSize(1)
  items!: InvoiceItemDto[];

  @ApiProperty({
    required: false,
    default: 0,
    minimum: 0,
    description: 'Overall discount applied after per-item discounts.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @ApiProperty({
    required: false,
    default: 0,
    minimum: 0,
    maximum: 1,
    description: 'e.g. 0.18 for 18%.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  taxRate?: number;
}
