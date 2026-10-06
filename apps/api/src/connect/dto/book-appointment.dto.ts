import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class BookAppointmentDto {
  @ApiProperty()
  @IsUUID()
  doctorProfileId!: string;

  @ApiProperty({
    description:
      'ISO 8601 UTC instant. Must exactly match a slot from GET /discover/doctors/:id/available-slots.',
  })
  @IsDateString()
  scheduledAt!: string;

  @ApiProperty({ required: false, default: 15, minimum: 5, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  durationMinutes?: number;

  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @ApiProperty({
    required: false,
    maxLength: 100,
    description:
      'A retried request with the same key returns the original booking instead of creating a second one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}
