import { ApiProperty } from '@nestjs/swagger';
import { QueueEntryStatus } from '@prisma/client';

/**
 * Deliberately exposes only the caller's own entry plus an aggregate count
 * of people ahead of them — never another patient's identity, token, or
 * position (master doc: "patient queue tracking with strict privacy").
 */
export class PatientQueueStatusResponseDto {
  @ApiProperty()
  queueEntryId!: string;

  @ApiProperty()
  appointmentId!: string;

  @ApiProperty()
  hospitalId!: string;

  @ApiProperty({ enum: QueueEntryStatus })
  status!: QueueEntryStatus;

  @ApiProperty()
  tokenNumber!: number;

  @ApiProperty({
    nullable: true,
    description:
      'How many WAITING patients are ahead in this queue. Null once called/completed/cancelled.',
  })
  position!: number | null;

  @ApiProperty()
  joinedAt!: Date;

  @ApiProperty({ nullable: true })
  calledAt!: Date | null;
}
