import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateClinicalNoteDto {
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chiefComplaint?: string;

  @ApiProperty({ required: false, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  history?: string;

  @ApiProperty({ required: false, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  examination?: string;

  @ApiProperty({ required: false, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  assessment?: string;

  @ApiProperty({ required: false, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  plan?: string;

  @ApiProperty({
    required: false,
    description:
      'Id of a prior note in the same encounter that this note corrects. The prior note is never ' +
      'edited or removed — it stays on the chart with this note linked as its correction.',
  })
  @IsOptional()
  @IsUUID()
  correctsId?: string;
}
