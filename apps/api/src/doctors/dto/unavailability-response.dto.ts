import { ApiProperty } from '@nestjs/swagger';

export class UnavailabilityResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() doctorProfileId!: string;
  @ApiProperty() startAt!: Date;
  @ApiProperty() endAt!: Date;
  @ApiProperty({ nullable: true }) reason!: string | null;
}
