import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PrescriptionItemDto } from './prescription-item.dto';

export class CreatePrescriptionDto {
  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [PrescriptionItemDto] })
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  @ArrayMinSize(1)
  items!: PrescriptionItemDto[];
}
