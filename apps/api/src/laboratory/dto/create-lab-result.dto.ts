import { ApiProperty } from '@nestjs/swagger';
import { LabResultFlag } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLabResultDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  value!: string;

  @ApiProperty({ required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiProperty({
    required: false,
    maxLength: 100,
    description:
      'Free-text snapshot (e.g. "70-110 mg/dL") taken at entry time — not a live catalog lookup.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceRange?: string;

  @ApiProperty({ required: false, enum: LabResultFlag })
  @IsOptional()
  @IsEnum(LabResultFlag)
  flag?: LabResultFlag;
}
