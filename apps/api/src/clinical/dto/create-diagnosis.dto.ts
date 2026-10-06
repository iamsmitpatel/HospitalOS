import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDiagnosisDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @ApiProperty({
    required: false,
    maxLength: 50,
    description:
      'Optional free-text code the clinician already knows (e.g. an ICD-10 code). Never validated ' +
      'against or auto-populated from a real coding system (master doc §15).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  diagnosisCode?: string;

  @ApiProperty({ required: false, maxLength: 50, example: 'primary' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;
}
