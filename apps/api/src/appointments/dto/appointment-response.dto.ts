import { ApiProperty } from '@nestjs/swagger';
import { AppointmentStatus } from '@prisma/client';

export class AppointmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hospitalId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() doctorProfileId!: string;
  @ApiProperty() departmentId!: string;
  @ApiProperty() scheduledAt!: Date;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ enum: AppointmentStatus }) status!: AppointmentStatus;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty({ nullable: true }) cancelledAt!: Date | null;
  @ApiProperty({ nullable: true }) cancellationReason!: string | null;
  @ApiProperty({ nullable: true }) rescheduledFromId!: string | null;
  @ApiProperty() bookedByUserId!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class PaginatedAppointmentsResponseDto {
  @ApiProperty({ type: [AppointmentResponseDto] }) items!: AppointmentResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
