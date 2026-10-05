import { ApiProperty } from '@nestjs/swagger';
import { Gender } from '@prisma/client';

export class PatientResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty({
    description: 'Hospital-scoped identifier, e.g. "SUN-000001". Unique per hospital.',
  })
  mrn!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() dateOfBirth!: Date;
  @ApiProperty({ enum: Gender }) gender!: Gender;
  @ApiProperty() phone!: string;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ nullable: true }) addressLine!: string | null;
  @ApiProperty({ nullable: true }) emergencyContactName!: string | null;
  @ApiProperty({ nullable: true }) emergencyContactPhone!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() registeredByUserId!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class PaginatedPatientsResponseDto {
  @ApiProperty({ type: [PatientResponseDto] }) items!: PatientResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
