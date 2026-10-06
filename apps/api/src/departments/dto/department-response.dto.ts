import { ApiProperty } from '@nestjs/swagger';

export class DepartmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
}
