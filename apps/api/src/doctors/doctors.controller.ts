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
import { DoctorStatus } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { CreateUnavailabilityDto } from './dto/create-unavailability.dto';
import { AvailableSlotsQueryDto } from './dto/available-slots-query.dto';
import { DoctorsService } from './doctors.service';

@ApiTags('doctors')
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Post()
  @RequirePermissions(Permission.DOCTOR_CREATE)
  @ResponseMessage('Doctor profile created successfully.')
  create(
    @Body() dto: CreateDoctorDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.doctorsService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.DOCTOR_READ)
  @ResponseMessage('Doctors retrieved successfully.')
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('departmentId') departmentId?: string,
    @Query('specialization') specialization?: string,
    @Query('status') status?: DoctorStatus,
  ) {
    return this.doctorsService.findAllForTenant(actor, { departmentId, specialization, status });
  }

  @Get(':id')
  @RequirePermissions(Permission.DOCTOR_READ)
  @ResponseMessage('Doctor retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.doctorsService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DOCTOR_UPDATE)
  @ResponseMessage('Doctor updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDoctorDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.doctorsService.update(id, dto, actor, req.correlationId);
  }

  @Post(':id/schedules')
  @RequirePermissions(Permission.DOCTOR_SCHEDULE_MANAGE)
  @ResponseMessage('Schedule created successfully.')
  createSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.doctorsService.createSchedule(id, dto, actor, req.correlationId);
  }

  @Get(':id/schedules')
  @RequirePermissions(Permission.DOCTOR_READ)
  @ResponseMessage('Schedules retrieved successfully.')
  listSchedules(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.doctorsService.listSchedules(id, actor);
  }

  @Post(':id/unavailability')
  @RequirePermissions(Permission.DOCTOR_SCHEDULE_MANAGE)
  @ResponseMessage('Unavailability recorded successfully.')
  createUnavailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateUnavailabilityDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.doctorsService.createUnavailability(id, dto, actor, req.correlationId);
  }

  @Get(':id/unavailability')
  @RequirePermissions(Permission.DOCTOR_READ)
  @ResponseMessage('Unavailability retrieved successfully.')
  listUnavailability(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.doctorsService.listUnavailability(id, actor);
  }

  @Get(':id/available-slots')
  @RequirePermissions(Permission.DOCTOR_READ)
  @ResponseMessage('Available slots retrieved successfully.')
  getAvailableSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AvailableSlotsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.doctorsService.getAvailableSlots(id, query.date, actor);
  }
}
