import { ApiProperty } from '@nestjs/swagger';
import { LabResultFlag, LabResultStatus } from '@prisma/client';

export class LabResultResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() labOrderItemId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() value!: string;
  @ApiProperty({ nullable: true }) unit!: string | null;
  @ApiProperty({ nullable: true }) referenceRange!: string | null;
  @ApiProperty({ enum: LabResultFlag, nullable: true }) flag!: LabResultFlag | null;
  @ApiProperty({ enum: LabResultStatus }) status!: LabResultStatus;
  @ApiProperty() enteredByUserId!: string;
  @ApiProperty() enteredAt!: Date;
  @ApiProperty({ nullable: true }) verifiedByUserId!: string | null;
  @ApiProperty({ nullable: true }) verifiedAt!: Date | null;
  @ApiProperty({ nullable: true }) amendsId!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
