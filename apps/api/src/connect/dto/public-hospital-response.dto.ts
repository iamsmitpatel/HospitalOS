import { ApiProperty } from '@nestjs/swagger';

/**
 * Deliberately a hand-picked field list, never a spread of the Prisma
 * Hospital row — mrnSequence/invoiceSequence/code/internal timestamps must
 * never reach an unauthenticated caller regardless of isPublic. See
 * /SECURITY.md ("only explicitly public information may be exposed").
 */
export class PublicHospitalResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true }) publicDescription!: string | null;
  @ApiProperty({ nullable: true }) addressLine!: string | null;
  @ApiProperty({ nullable: true }) city!: string | null;
  @ApiProperty({ nullable: true }) publicPhone!: string | null;
  @ApiProperty({ nullable: true }) publicEmail!: string | null;
  @ApiProperty({ nullable: true }) operatingHours!: string | null;
}

export class PaginatedPublicHospitalsResponseDto {
  @ApiProperty({ type: [PublicHospitalResponseDto] }) items!: PublicHospitalResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class PublicDepartmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
}

export class PublicDoctorResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() specialization!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() hospitalName!: string;
  @ApiProperty() departmentId!: string;
  @ApiProperty() departmentName!: string;
}
