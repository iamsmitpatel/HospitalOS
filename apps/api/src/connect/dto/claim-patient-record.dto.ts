import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const PHONE_PATTERN = /^[0-9+\-\s()]{7,20}$/;

export class ClaimPatientRecordDto {
  @ApiProperty({ description: 'The hospital that holds the pre-existing MRN record.' })
  @IsUUID()
  hospitalId!: string;

  @ApiProperty({ description: 'The MRN assigned by that hospital, e.g. GEN-000042.' })
  @IsString()
  @MaxLength(50)
  mrn!: string;

  @ApiProperty()
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty()
  @Matches(PHONE_PATTERN, { message: 'phone must be 7-20 characters of digits, spaces, +, -, ()' })
  phone!: string;
}
