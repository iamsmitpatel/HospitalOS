import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Deliberately narrow: only the non-status, non-identity field is editable
 * here. Status changes go through the dedicated action endpoints (cancel,
 * reschedule, no-show) so the state machine is never bypassed by an
 * arbitrary PATCH body (master doc §26/§77).
 */
export class UpdateAppointmentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
