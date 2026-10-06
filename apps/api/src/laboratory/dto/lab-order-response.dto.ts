import { ApiProperty } from '@nestjs/swagger';
import { LabOrderItemStatus, LabOrderStatus, LabResultFlag, LabResultStatus } from '@prisma/client';

export class LabOrderItemResultResponseDto {
  @ApiProperty() id!: string;
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
}

export class LabOrderItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() labTestId!: string;
  @ApiProperty({ enum: LabOrderItemStatus }) status!: LabOrderItemStatus;
  @ApiProperty({ nullable: true }) specimenType!: string | null;
  @ApiProperty({ nullable: true }) collectedAt!: Date | null;
  @ApiProperty({ nullable: true }) collectedByUserId!: string | null;
  @ApiProperty({ type: LabOrderItemResultResponseDto, nullable: true })
  result!: LabOrderItemResultResponseDto | null;
}

export class LabOrderResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() doctorProfileId!: string;
  @ApiProperty({ enum: LabOrderStatus }) status!: LabOrderStatus;
  @ApiProperty() orderedAt!: Date;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: [LabOrderItemResponseDto] }) items!: LabOrderItemResponseDto[];
}
