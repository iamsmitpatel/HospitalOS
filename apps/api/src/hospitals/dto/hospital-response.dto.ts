import { ApiProperty } from '@nestjs/swagger';

export class HospitalResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() code!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
}
