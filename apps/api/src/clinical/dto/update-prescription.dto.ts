import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PrescriptionItemDto } from './prescription-item.dto';

/** Only legal while the prescription is DRAFT — see prescriptions.service.ts. Supplying items replaces the full set. */
export class UpdatePrescriptionDto {
  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ required: false, type: [PrescriptionItemDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  @ArrayMinSize(1)
  items?: PrescriptionItemDto[];
}
