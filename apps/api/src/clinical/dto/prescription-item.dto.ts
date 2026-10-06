import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

export class PrescriptionItemDto {
  @ApiProperty()
  @IsUUID()
  medicineId!: string;

  @ApiProperty({ example: '500mg' })
  @IsString()
  @MaxLength(100)
  dosage!: string;

  @ApiProperty({ example: 'Twice daily' })
  @IsString()
  @MaxLength(100)
  frequency!: string;

  @ApiProperty({ example: '5 days' })
  @IsString()
  @MaxLength(100)
  duration!: string;

  @ApiProperty({ required: false, example: 'Oral' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  route?: string;

  @ApiProperty({ required: false, example: 'Take after food' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  instructions?: string;

  @ApiProperty({ minimum: 1, description: 'Total units to dispense for this item.' })
  @IsInt()
  @IsPositive()
  quantity!: number;
}
