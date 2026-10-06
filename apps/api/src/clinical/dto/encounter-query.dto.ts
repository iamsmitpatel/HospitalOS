import { ApiProperty } from '@nestjs/swagger';
import { EncounterStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class EncounterQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  doctorProfileId?: string;

  @ApiProperty({ required: false, enum: EncounterStatus })
  @IsOptional()
  @IsEnum(EncounterStatus)
  status?: EncounterStatus;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
