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

export class CreateAppointmentDto {
  @ApiProperty()
  @IsUUID()
  patientId!: string;

  @ApiProperty()
  @IsUUID()
  doctorProfileId!: string;

  @ApiProperty({
    description:
      'ISO 8601 UTC instant. Must exactly match a slot returned by GET /doctors/:id/available-slots.',
  })
  @IsDateString()
  scheduledAt!: string;

  @ApiProperty({ required: false, default: 15, minimum: 5, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  durationMinutes?: number;

  @ApiProperty({
    required: false,
    example: 'Annual checkup',
    description: 'Patient-provided reason for the visit — never a diagnosis.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
