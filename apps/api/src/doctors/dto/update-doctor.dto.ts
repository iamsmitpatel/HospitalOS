import { ApiProperty } from '@nestjs/swagger';
import { DoctorStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateDoctorDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  specialization?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  registrationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  displayName?: string;

  @ApiProperty({
    required: false,
    enum: DoctorStatus,
    description:
      'INACTIVE/SUSPENDED doctors cannot receive new appointments (master doc §15) — enforced in appointments.service.ts.',
  })
  @IsOptional()
  @IsEnum(DoctorStatus)
  status?: DoctorStatus;
}
