import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class CreateDispenseDto {
  @ApiProperty()
  @IsUUID()
  prescriptionItemId!: string;

  @ApiProperty({
    minimum: 1,
    description: 'May be less than the full prescribed quantity (partial fill).',
  })
  @IsInt()
  @IsPositive()
  quantity!: number;
}
