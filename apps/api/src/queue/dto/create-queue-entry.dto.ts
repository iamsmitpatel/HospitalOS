import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** "Check in" — joining the queue is always tied to an existing appointment (no walk-in-without-appointment flow in Phase 3). */
export class CreateQueueEntryDto {
  @ApiProperty()
  @IsUUID()
  appointmentId!: string;
}
