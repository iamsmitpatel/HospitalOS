import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** HospitalOS Connect (Phase 5) — only the public-discovery-facing fields; name/slug/code/isActive stay on UpdateHospitalDto (SUPER_ADMIN-only). */
export class UpdatePublicProfileDto {
  @ApiProperty({
    required: false,
    description: 'Whether this hospital is listed in HospitalOS Connect discovery.',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  publicDescription?: string;

  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiProperty({ required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  publicPhone?: string;

  @ApiProperty({ required: false, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  publicEmail?: string;

  @ApiProperty({ required: false, maxLength: 200, example: 'Mon-Sat 9:00-18:00' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  operatingHours?: string;
}
