import { ApiProperty } from '@nestjs/swagger';
import { QueueEntryStatus } from '@prisma/client';

export class QueueEntryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() queueId!: string;
  @ApiProperty({ nullable: true }) appointmentId!: string | null;
  @ApiProperty() patientId!: string;
  @ApiProperty() tokenNumber!: number;
  @ApiProperty({ enum: QueueEntryStatus }) status!: QueueEntryStatus;
  @ApiProperty() priority!: number;
  @ApiProperty() joinedAt!: Date;
  @ApiProperty({ nullable: true }) calledAt!: Date | null;
  @ApiProperty({ nullable: true }) completedAt!: Date | null;
  @ApiProperty({ nullable: true }) skippedAt!: Date | null;
  @ApiProperty({ nullable: true }) cancelledAt!: Date | null;
}
