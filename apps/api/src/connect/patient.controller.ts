import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { AppException } from '../common/exceptions/app.exception';
import { CancelAppointmentDto } from '../appointments/dto/cancel-appointment.dto';
import { AppointmentsService } from '../appointments/appointments.service';
import { PatientsService } from '../patients/patients.service';
import { PatientQueueService } from './patient-queue.service';
import { PatientMedicalRecordsService } from './patient-medical-records.service';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { ClaimPatientRecordDto } from './dto/claim-patient-record.dto';

/**
 * HospitalOS Connect's authenticated patient surface — every route here
 * requires PATIENT_PORTAL_ACCESS (granted only to Role.PATIENT) and
 * resolves "which records are mine" via actor.userId, never actor.hospitalId
 * (a Connect account has none). See patients.service.ts / appointments.service.ts
 * for the matching ownership-check methods.
 */
@ApiTags('patient')
@Controller('patient')
export class PatientController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly patientsService: PatientsService,
    private readonly patientQueueService: PatientQueueService,
    private readonly medicalRecordsService: PatientMedicalRecordsService,
  ) {}

  @Get('records')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Patient records retrieved successfully.')
  listMyRecords(@CurrentUser() actor: AuthenticatedUser) {
    return this.patientsService.listForConnectUser(actor.userId);
  }

  @Post('records/claim')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Record linked successfully.')
  async claimRecord(
    @Body() dto: ClaimPatientRecordDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    const patient = await this.patientsService.claimExistingRecord(
      { id: actor.userId },
      dto,
      req.correlationId,
    );
    return this.patientsService.toPatientResponseDto(patient);
  }

  @Post('appointments')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Appointment booked successfully.')
  bookAppointment(
    @Body() dto: BookAppointmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.appointmentsService.createForConnectPatient(dto, actor.userId, req.correlationId);
  }

  @Get('appointments')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Appointments retrieved successfully.')
  listMyAppointments(@CurrentUser() actor: AuthenticatedUser) {
    return this.appointmentsService.listForConnectUser(actor.userId);
  }

  @Get('appointments/:id')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Appointment retrieved successfully.')
  getMyAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.appointmentsService.getOneForConnectUser(id, actor.userId);
  }

  @Post('appointments/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Appointment cancelled successfully.')
  cancelMyAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.appointmentsService.cancelForConnectPatient(
      id,
      dto,
      actor.userId,
      req.correlationId,
    );
  }

  @Get('appointments/:id/queue-status')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Queue status retrieved successfully.')
  getQueueStatus(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.patientQueueService.getStatusForAppointment(id, actor.userId);
  }

  @Get('queue')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Active queue entries retrieved successfully.')
  listMyQueueEntries(@CurrentUser() actor: AuthenticatedUser) {
    return this.patientQueueService.listMyActiveEntries(actor.userId);
  }

  @Get('records/:patientId/encounters')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Encounters retrieved successfully.')
  listEncounters(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.medicalRecordsService.listEncounters(patientId, actor.userId);
  }

  @Get('records/:patientId/encounters/:encounterId')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Encounter retrieved successfully.')
  async getEncounterDetail(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const detail = await this.medicalRecordsService.getEncounterDetail(
      patientId,
      encounterId,
      actor.userId,
    );
    if (!detail) {
      throw new AppException('ENCOUNTER_NOT_FOUND', 'Encounter not found.', HttpStatus.NOT_FOUND);
    }
    return detail;
  }

  @Get('records/:patientId/prescriptions')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Prescriptions retrieved successfully.')
  listPrescriptions(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.medicalRecordsService.listPrescriptions(patientId, actor.userId);
  }

  @Get('records/:patientId/lab-orders')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Lab orders retrieved successfully.')
  listLabOrders(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.medicalRecordsService.listLabOrders(patientId, actor.userId);
  }

  @Get('records/:patientId/invoices')
  @RequirePermissions(Permission.PATIENT_PORTAL_ACCESS)
  @ResponseMessage('Invoices retrieved successfully.')
  listInvoices(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.medicalRecordsService.listInvoices(patientId, actor.userId);
  }
}
