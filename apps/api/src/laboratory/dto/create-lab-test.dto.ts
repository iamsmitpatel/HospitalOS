import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLabTestDto {
  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ maxLength: 50, description: 'Unique per hospital, e.g. "CBC".' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code!: string;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiProperty({ required: false, maxLength: 100, example: 'Venous blood' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sampleType?: string;

  @ApiProperty({ required: false, maxLength: 20, example: 'mg/dL' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiProperty({
    required: false,
    description: 'Only for tests with a single expected numeric band — otherwise leave unset.',
  })
  @IsOptional()
  @IsNumber()
  referenceRangeLow?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  referenceRangeHigh?: number;
}
