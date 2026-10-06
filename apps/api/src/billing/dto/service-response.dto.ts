import { ApiProperty } from '@nestjs/swagger';
import { ServiceCategory } from '@prisma/client';

export class ServiceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: ServiceCategory }) category!: ServiceCategory;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({
    nullable: true,
    description: 'The current (effectiveTo: null) price, if one has been set.',
  })
  currentPrice!: string | null;
  @ApiProperty() createdAt!: Date;
}
