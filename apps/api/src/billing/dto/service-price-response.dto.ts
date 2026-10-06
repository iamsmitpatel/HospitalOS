import { ApiProperty } from '@nestjs/swagger';

export class ServicePriceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() serviceId!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() effectiveFrom!: Date;
  @ApiProperty({ nullable: true }) effectiveTo!: Date | null;
}
