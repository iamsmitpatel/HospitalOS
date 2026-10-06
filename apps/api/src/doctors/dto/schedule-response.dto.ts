import { ApiProperty } from '@nestjs/swagger';
import { DayOfWeek } from '@prisma/client';

export class ScheduleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() doctorProfileId!: string;
  @ApiProperty({ enum: DayOfWeek }) dayOfWeek!: DayOfWeek;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
  @ApiProperty() slotDurationMinutes!: number;
  @ApiProperty() isActive!: boolean;
}
