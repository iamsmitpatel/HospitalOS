import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class AvailableSlotsQueryDto {
  @ApiProperty({
    example: '2026-10-12',
    description: 'Calendar date (hospital-local), YYYY-MM-DD.',
  })
  @IsDateString({ strict: true })
  date!: string;
}
