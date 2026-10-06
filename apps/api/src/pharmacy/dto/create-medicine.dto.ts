import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMedicineDto {
  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ required: false, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  genericName?: string;

  @ApiProperty({ required: false, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  brandName?: string;

  @ApiProperty({ required: false, maxLength: 50, example: '500mg' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  strength?: string;

  @ApiProperty({ required: false, maxLength: 50, example: 'tablet' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  form?: string;

  @ApiProperty({ required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;
}
