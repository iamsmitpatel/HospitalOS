import { Body, Controller, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { DoctorsService } from './doctors.service';

/** Flat route per master doc §56 (PATCH /api/v1/schedules/:id) — logic lives in DoctorsService. */
@ApiTags('schedules')
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Patch(':id')
  @RequirePermissions(Permission.DOCTOR_SCHEDULE_MANAGE)
  @ResponseMessage('Schedule updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.doctorsService.updateSchedule(id, dto, actor, req.correlationId);
  }
}
