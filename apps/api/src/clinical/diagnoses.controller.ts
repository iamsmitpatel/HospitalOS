import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateDiagnosisDto } from './dto/create-diagnosis.dto';
import { UpdateDiagnosisDto } from './dto/update-diagnosis.dto';
import { DiagnosesService } from './diagnoses.service';

/** Flat route, same reasoning as schedules.controller.ts — logic lives in DiagnosesService. */
@ApiTags('clinical')
@Controller('diagnoses')
export class DiagnosesController {
  constructor(private readonly diagnosesService: DiagnosesService) {}

  @Get(':id')
  @RequirePermissions(Permission.ENCOUNTER_READ)
  @ResponseMessage('Diagnosis retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.diagnosesService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DIAGNOSIS_MANAGE)
  @ResponseMessage('Diagnosis updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiagnosisDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.diagnosesService.update(id, dto, actor, req.correlationId);
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DIAGNOSIS_MANAGE)
  @ResponseMessage('Diagnosis finalized successfully.')
  finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.diagnosesService.finalize(id, actor, req.correlationId);
  }

  @Post(':id/amend')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.DIAGNOSIS_MANAGE)
  @ResponseMessage('Diagnosis amended successfully.')
  amend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDiagnosisDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.diagnosesService.amend(id, dto, actor, req.correlationId);
  }
}
