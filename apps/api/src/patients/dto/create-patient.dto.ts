import { ApiProperty } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PHONE_PATTERN = /^[0-9+\-\s()]{7,20}$/;

export class CreatePatientDto {
  @ApiProperty({ example: 'Asha' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Patel' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({
    example: '1990-05-14',
    description: 'ISO date string. Must not be in the future.',
  })
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty({ enum: Gender })
  @IsEnum(Gender)
  gender!: Gender;

  @ApiProperty({ example: '+91 98765 43210' })
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be 7-20 characters of digits, spaces, +, -, ()' })
  phone!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false, example: '221B Baker Street, Mumbai' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'emergencyContactPhone must be 7-20 characters of digits, spaces, +, -, ()',
  })
  emergencyContactPhone?: string;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Set true to register anyway after being warned of a likely-duplicate match (same phone + date of birth already on file). Does not bypass any other validation. See /DECISIONS.md — master doc §22 explicitly forbids auto-merging on probabilistic matches, so this is a human confirmation, not an override of a hard rule.',
  })
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}
