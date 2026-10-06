import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class QueueQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiProperty({ required: false, description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString({ strict: true })
  date?: string;
}
