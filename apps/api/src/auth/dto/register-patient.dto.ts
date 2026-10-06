import { ApiProperty } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsDateString,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PHONE_PATTERN = /^[0-9+\-\s()]{7,20}$/;

/**
 * HospitalOS Connect self-registration (Phase 5) — distinct from RegisterDto
 * above, which is the bootstrap-only path that creates the platform's first
 * SUPER_ADMIN. This always creates a Role.PATIENT account with
 * hospitalId: null (patients are not scoped to one hospital — see
 * AuthService#registerPatient and /DECISIONS.md).
 */
export class RegisterPatientDto {
  @ApiProperty({ example: 'patient@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Str0ngPassword!' })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt silently truncates beyond 72 bytes
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'password must contain at least one lowercase letter, one uppercase letter, and one number',
  })
  password!: string;

  @ApiProperty({ example: 'Asha' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Verma' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ example: '+91 90000 00001' })
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be 7-20 characters of digits, spaces, +, -, ()' })
  phone!: string;

  @ApiProperty({ description: 'ISO date string. Must not be in the future.' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty({ enum: Gender })
  @IsEnum(Gender)
  gender!: Gender;
}
