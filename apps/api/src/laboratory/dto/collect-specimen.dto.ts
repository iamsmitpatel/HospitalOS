import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CollectSpecimenDto {
  @ApiProperty({ required: false, maxLength: 100, example: 'Venous blood' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  specimenType?: string;
}
