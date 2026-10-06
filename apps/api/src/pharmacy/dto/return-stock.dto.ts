import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class ReturnStockDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @IsPositive()
  quantity!: number;

  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
