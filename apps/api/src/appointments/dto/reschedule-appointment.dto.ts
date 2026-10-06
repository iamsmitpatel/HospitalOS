import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class RescheduleAppointmentDto {
  @ApiProperty({
    description: 'ISO 8601 UTC instant for the new time. Must match an available slot.',
  })
  @IsDateString()
  scheduledAt!: string;
}
