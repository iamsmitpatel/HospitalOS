import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, NotEquals } from 'class-validator';

export class AdjustStockDto {
  @ApiProperty({
    description:
      'Signed change to apply, e.g. -3 for breakage/loss, +3 for a recount correction. Cannot be 0.',
  })
  @IsInt()
  @NotEquals(0)
  delta!: number;

  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
