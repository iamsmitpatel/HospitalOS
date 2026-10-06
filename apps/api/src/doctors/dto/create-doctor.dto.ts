import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateDoctorDto {
  @ApiProperty({
    description:
      'An existing User id with role=DOCTOR in this hospital, not yet attached to a doctor profile. Accounts are created via POST /users, not here — see /DECISIONS.md.',
  })
  @IsUUID()
  userId!: string;

  @ApiProperty()
  @IsUUID()
  departmentId!: string;

  @ApiProperty({ example: 'Cardiology' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  specialization!: string;

  @ApiProperty({
    required: false,
    description:
      'Professional registration/license identifier, if on file. Not format-validated beyond length — no universal format exists (master doc §13). Unique per hospital.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  registrationNumber?: string;

  @ApiProperty({
    required: false,
    description: 'Defaults to "Dr. {firstName} {lastName}" if omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  displayName?: string;

  @ApiProperty({
    required: false,
    description:
      'Target hospital. Required when a SUPER_ADMIN creates a doctor profile. Ignored (server-derives from the caller) when a HOSPITAL_ADMIN is creating it.',
  })
  @IsOptional()
  @IsUUID()
  hospitalId?: string;
}
