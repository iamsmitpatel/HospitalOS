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
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientQueryDto } from './dto/patient-query.dto';
import { PatientsService } from './patients.service';

const WRITE_ROLES = [Role.HOSPITAL_ADMIN, Role.DOCTOR, Role.NURSE, Role.RECEPTIONIST];
const READ_ROLES = [...WRITE_ROLES, Role.PHARMACIST, Role.LAB_TECHNICIAN, Role.ACCOUNTANT];

@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  @ResponseMessage('Patient registered successfully.')
  create(
    @Body() dto: CreatePatientDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.patientsService.create(dto, actor, req.correlationId);
  }

  @Get()
  @Roles(...READ_ROLES)
  @ResponseMessage('Patients retrieved successfully.')
  findAll(@Query() query: PatientQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.patientsService.findAllForTenant(actor, query);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @ResponseMessage('Patient retrieved successfully.')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.patientsService.findOneForTenant(id, actor, req.correlationId);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
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
