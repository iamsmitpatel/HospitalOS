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
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentQueryDto } from './dto/appointment-query.dto';
import { AppointmentsService } from './appointments.service';

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @RequirePermissions(Permission.APPOINTMENT_CREATE)
  @ResponseMessage('Appointment created successfully.')
  create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.appointmentsService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.APPOINTMENT_READ)
  @ResponseMessage('Appointments retrieved successfully.')
  findAll(@Query() query: AppointmentQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.appointmentsService.findAllForTenant(actor, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.APPOINTMENT_READ)
  @ResponseMessage('Appointment retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.appointmentsService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.APPOINTMENT_UPDATE)
  @ResponseMessage('Appointment updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.appointmentsService.update(id, dto, actor, req.correlationId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.APPOINTMENT_CANCEL)
  @ResponseMessage('Appointment cancelled successfully.')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.appointmentsService.cancel(id, dto, actor, req.correlationId);
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.APPOINTMENT_RESCHEDULE)
  @ResponseMessage('Appointment rescheduled successfully.')
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.appointmentsService.reschedule(id, dto, actor, req.correlationId);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.APPOINTMENT_UPDATE)
  @ResponseMessage('Appointment marked as no-show.')
  markNoShow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.appointmentsService.markNoShow(id, actor, req.correlationId);
  }
}
