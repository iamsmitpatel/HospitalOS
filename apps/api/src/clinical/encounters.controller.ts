import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateEncounterDto } from './dto/create-encounter.dto';
import { EncounterQueryDto } from './dto/encounter-query.dto';
import { CreateVitalsDto } from './dto/create-vitals.dto';
import { CreateClinicalNoteDto } from './dto/create-clinical-note.dto';
import { CreateDiagnosisDto } from './dto/create-diagnosis.dto';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { EncountersService } from './encounters.service';
import { VitalsService } from './vitals.service';
import { ClinicalNotesService } from './clinical-notes.service';
import { DiagnosesService } from './diagnoses.service';
import { PrescriptionsService } from './prescriptions.service';

@ApiTags('clinical')
@Controller('encounters')
export class EncountersController {
  constructor(
    private readonly encountersService: EncountersService,
    private readonly vitalsService: VitalsService,
    private readonly clinicalNotesService: ClinicalNotesService,
    private readonly diagnosesService: DiagnosesService,
    private readonly prescriptionsService: PrescriptionsService,
  ) {}

  @Post()
  @RequirePermissions(Permission.ENCOUNTER_MANAGE)
  @ResponseMessage('Encounter started successfully.')
  create(
    @Body() dto: CreateEncounterDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.encountersService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.ENCOUNTER_READ)
  @ResponseMessage('Encounters retrieved successfully.')
  findAll(@Query() query: EncounterQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.encountersService.findAllForTenant(actor, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.ENCOUNTER_READ)
  @ResponseMessage('Encounter retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.encountersService.findOneForTenant(id, actor);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ENCOUNTER_MANAGE)
  @ResponseMessage('Encounter completed successfully.')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.encountersService.complete(id, actor, req.correlationId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ENCOUNTER_MANAGE)
  @ResponseMessage('Encounter cancelled successfully.')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.encountersService.cancel(id, actor, req.correlationId);
  }

  // --- Vitals -------------------------------------------------------------

  @Post(':id/vitals')
  @RequirePermissions(Permission.VITALS_CREATE)
  @ResponseMessage('Vitals recorded successfully.')
  createVitals(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVitalsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.vitalsService.create(id, dto, actor, req.correlationId);
  }

  @Get(':id/vitals')
  @RequirePermissions(Permission.ENCOUNTER_READ)
  @ResponseMessage('Vitals retrieved successfully.')
  listVitals(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.vitalsService.listForEncounter(id, actor);
  }

  // --- Clinical notes ------------------------------------------------------

  @Post(':id/notes')
  @RequirePermissions(Permission.CLINICAL_NOTE_CREATE)
  @ResponseMessage('Clinical note created successfully.')
  createNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateClinicalNoteDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.clinicalNotesService.create(id, dto, actor, req.correlationId);
  }

  @Get(':id/notes')
  @RequirePermissions(Permission.ENCOUNTER_READ)
  @ResponseMessage('Clinical notes retrieved successfully.')
  listNotes(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.clinicalNotesService.listForEncounter(id, actor);
  }

  // --- Diagnoses -----------------------------------------------------------

  @Post(':id/diagnoses')
  @RequirePermissions(Permission.DIAGNOSIS_MANAGE)
  @ResponseMessage('Diagnosis recorded successfully.')
  createDiagnosis(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDiagnosisDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.diagnosesService.create(id, dto, actor, req.correlationId);
  }

  @Get(':id/diagnoses')
  @RequirePermissions(Permission.ENCOUNTER_READ)
  @ResponseMessage('Diagnoses retrieved successfully.')
  listDiagnoses(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.diagnosesService.listForEncounter(id, actor);
  }

  // --- Prescriptions ---------------------------------------------------------

  @Post(':id/prescriptions')
  @RequirePermissions(Permission.PRESCRIPTION_MANAGE)
  @ResponseMessage('Prescription created successfully.')
  createPrescription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePrescriptionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.prescriptionsService.create(id, dto, actor, req.correlationId);
  }

  @Get(':id/prescriptions')
  @RequirePermissions(Permission.PRESCRIPTION_READ)
  @ResponseMessage('Prescriptions retrieved successfully.')
  listPrescriptions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.prescriptionsService.listForEncounter(id, actor);
  }
}
