import { ApiProperty } from '@nestjs/swagger';
import { LabResultFlag } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Only legal while the result is ENTERED (not yet verified) — see lab-results.service.ts. */
export class UpdateLabResultDto {
  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  value?: string;

  @ApiProperty({ required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceRange?: string;

  @ApiProperty({ required: false, enum: LabResultFlag })
  @IsOptional()
  @IsEnum(LabResultFlag)
  flag?: LabResultFlag;
}
