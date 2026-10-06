import { ApiProperty } from '@nestjs/swagger';
import { DoctorStatus } from '@prisma/client';

export class DoctorResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() departmentId!: string;
  @ApiProperty() specialization!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true }) registrationNumber!: string | null;
  @ApiProperty({ enum: DoctorStatus }) status!: DoctorStatus;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() email!: string;
  @ApiProperty() createdAt!: Date;
}
