import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateHospitalDto {
  @ApiProperty({ example: 'Sunrise Multi-Speciality Hospital' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'sunrise-multi-speciality' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'slug must be lowercase, URL-safe, and hyphen-separated (e.g. "sunrise-multi-speciality")',
  })
  slug!: string;

  @ApiProperty({
    example: 'SUN',
    description:
      'Short uppercase identifier used as the MRN prefix (e.g. "SUN" -> SUN-000001). Immutable once set.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z0-9]{2,10}$/, {
    message: 'code must be 2-10 uppercase letters/digits (e.g. "SUN")',
  })
  code!: string;
}
