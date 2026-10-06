import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class CreateEncounterDto {
  @ApiProperty({
    required: false,
    description:
      'Starts the encounter from an existing appointment (must already be IN_CONSULTATION — i.e. ' +
      'called and started from the queue — and belong to the caller). patientId/doctorProfileId/' +
      'departmentId are derived from the appointment, never from the request body.',
  })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @ApiProperty({
    required: false,
    description:
      'Required for a walk-in encounter (no appointmentId). Ignored when appointmentId is set.',
  })
  @IsOptional()
  @IsUUID()
  patientId?: string;
}
