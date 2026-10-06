import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsUUID, ValidateNested } from 'class-validator';

class LabOrderItemDto {
  @ApiProperty()
  @IsUUID()
  labTestId!: string;
}

export class CreateLabOrderDto {
  @ApiProperty({ type: [LabOrderItemDto] })
  @ValidateNested({ each: true })
  @Type(() => LabOrderItemDto)
  @ArrayMinSize(1)
  items!: LabOrderItemDto[];
}
