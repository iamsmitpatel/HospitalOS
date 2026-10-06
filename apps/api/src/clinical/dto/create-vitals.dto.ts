import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Bounds here are plausible-physiological outer limits, not clinical normal
 * ranges (master doc §12: clinical judgment belongs to clinicians, not this
 * layer) — wide enough to admit any real reading, narrow enough to catch
 * obvious data-entry errors (e.g. a temperature typed in Fahrenheit).
 */
export class CreateVitalsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  bloodPressureSystolic?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  bloodPressureDiastolic?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  heartRateBpm?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(45)
  temperatureCelsius?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  respiratoryRate?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  oxygenSaturationPercent?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  weightKg?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(300)
  heightCm?: number;
}
