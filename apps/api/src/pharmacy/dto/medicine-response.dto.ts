import { ApiProperty } from '@nestjs/swagger';

export class MedicineResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) genericName!: string | null;
  @ApiProperty({ nullable: true }) brandName!: string | null;
  @ApiProperty({ nullable: true }) strength!: string | null;
  @ApiProperty({ nullable: true }) form!: string | null;
  @ApiProperty({ nullable: true }) unit!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
}
