import { ApiProperty } from '@nestjs/swagger';
import { DayOfWeek } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class CreateScheduleDto {
  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @ApiProperty({ example: '09:00', description: 'Hospital-local wall-clock time, 24h "HH:mm".' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be in HH:mm (24h) format' })
  startTime!: string;

  @ApiProperty({ example: '12:00', description: 'Must be strictly after startTime.' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be in HH:mm (24h) format' })
  endTime!: string;

  @ApiProperty({ required: false, default: 15, minimum: 5, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  slotDurationMinutes?: number;
}
