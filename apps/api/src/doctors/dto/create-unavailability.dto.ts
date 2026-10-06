import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateUnavailabilityDto {
  @ApiProperty({ description: 'ISO 8601 UTC instant.' })
  @IsDateString()
  startAt!: string;

  @ApiProperty({ description: 'ISO 8601 UTC instant, must be after startAt.' })
  @IsDateString()
  endAt!: string;

  @ApiProperty({ required: false, example: 'Annual leave' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
