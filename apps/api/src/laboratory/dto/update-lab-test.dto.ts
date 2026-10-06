import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateLabTestDto {
  @ApiProperty({ required: false, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sampleType?: string;

  @ApiProperty({ required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  referenceRangeLow?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  referenceRangeHigh?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
