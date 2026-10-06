import { ApiProperty } from '@nestjs/swagger';

export class ClinicalNoteResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty({ nullable: true }) chiefComplaint!: string | null;
  @ApiProperty({ nullable: true }) history!: string | null;
  @ApiProperty({ nullable: true }) examination!: string | null;
  @ApiProperty({ nullable: true }) assessment!: string | null;
  @ApiProperty({ nullable: true }) plan!: string | null;
  @ApiProperty() authorUserId!: string;
  @ApiProperty({ nullable: true }) correctsId!: string | null;
  @ApiProperty() createdAt!: Date;
}
