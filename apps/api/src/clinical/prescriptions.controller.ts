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
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { PrescriptionsService } from './prescriptions.service';

/** Flat route, same reasoning as schedules.controller.ts — logic lives in PrescriptionsService. */
@ApiTags('clinical')
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptionsService: PrescriptionsService) {}

  @Get(':id')
  @RequirePermissions(Permission.PRESCRIPTION_READ)
  @ResponseMessage('Prescription retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.prescriptionsService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PRESCRIPTION_MANAGE)
  @ResponseMessage('Prescription updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrescriptionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.prescriptionsService.update(id, dto, actor, req.correlationId);
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PRESCRIPTION_MANAGE)
  @ResponseMessage('Prescription finalized successfully.')
  finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.prescriptionsService.finalize(id, actor, req.correlationId);
  }

  @Post(':id/amend')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.PRESCRIPTION_MANAGE)
  @ResponseMessage('Prescription amended successfully.')
  amend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePrescriptionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.prescriptionsService.amend(id, dto, actor, req.correlationId);
  }
}
