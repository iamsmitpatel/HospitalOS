import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty({ nullable: true }) hospitalId!: string | null;
}

export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}

export class MeHospitalDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

/** Shape matches master doc §26 exactly — a nested hospital summary, not just hospitalId. */
export class MeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty({ type: MeHospitalDto, nullable: true }) hospital!: MeHospitalDto | null;
}
