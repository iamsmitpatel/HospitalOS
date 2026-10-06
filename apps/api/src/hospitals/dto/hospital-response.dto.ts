import { ApiProperty } from '@nestjs/swagger';

export class HospitalResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() code!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isPublic!: boolean;
  @ApiProperty({ nullable: true }) publicDescription!: string | null;
  @ApiProperty({ nullable: true }) addressLine!: string | null;
  @ApiProperty({ nullable: true }) city!: string | null;
  @ApiProperty({ nullable: true }) publicPhone!: string | null;
  @ApiProperty({ nullable: true }) publicEmail!: string | null;
  @ApiProperty({ nullable: true }) operatingHours!: string | null;
  @ApiProperty() createdAt!: Date;
}
