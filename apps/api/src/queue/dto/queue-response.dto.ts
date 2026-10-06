import { ApiProperty } from '@nestjs/swagger';
import { QueueEntryResponseDto } from './queue-entry-response.dto';

export class QueueResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty({ nullable: true }) departmentId!: string | null;
  @ApiProperty({ nullable: true }) doctorProfileId!: string | null;
  @ApiProperty() queueDate!: Date;
  @ApiProperty() isActive!: boolean;
}

export class QueueDetailResponseDto extends QueueResponseDto {
  @ApiProperty({ type: [QueueEntryResponseDto] }) entries!: QueueEntryResponseDto[];
}
