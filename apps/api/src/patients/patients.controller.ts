import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientQueryDto } from './dto/patient-query.dto';
import { PatientsService } from './patients.service';

@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @RequirePermissions(Permission.PATIENT_CREATE)
  @ResponseMessage('Patient registered successfully.')
  create(
    @Body() dto: CreatePatientDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.patientsService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.PATIENT_READ)
  @ResponseMessage('Patients retrieved successfully.')
  findAll(@Query() query: PatientQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.patientsService.findAllForTenant(actor, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.PATIENT_READ)
  @ResponseMessage('Patient retrieved successfully.')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.patientsService.findOneForTenant(id, actor, req.correlationId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PATIENT_UPDATE)
  @ResponseMessage('Patient updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.patientsService.update(id, dto, actor, req.correlationId);
  }
}
