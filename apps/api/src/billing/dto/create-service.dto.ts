import { ApiProperty } from '@nestjs/swagger';
import { ServiceCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateServiceDto {
  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ maxLength: 50, description: 'Unique per hospital.' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code!: string;

  @ApiProperty({ required: false, enum: ServiceCategory, default: ServiceCategory.OTHER })
  @IsOptional()
  @IsEnum(ServiceCategory)
  category?: ServiceCategory;
}
