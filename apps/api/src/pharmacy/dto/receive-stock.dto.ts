import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class ReceiveStockDto {
  @ApiProperty({ maxLength: 50, description: 'Unique per medicine within this hospital.' })
  @IsString()
  @MaxLength(50)
  batchNumber!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @IsPositive()
  quantityReceived!: number;

  @ApiProperty({ description: 'ISO date (YYYY-MM-DD).' })
  @IsDateString({ strict: true })
  expiryDate!: string;

  @ApiProperty({ required: false, description: 'Per-unit purchase price.' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  purchasePrice?: number;
}
