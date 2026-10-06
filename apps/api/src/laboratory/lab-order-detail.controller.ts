import {
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
import { LabOrdersService } from './lab-orders.service';

/** Flat route, same reasoning as schedules.controller.ts — logic lives in LabOrdersService. */
@ApiTags('laboratory')
@Controller('lab-orders')
export class LabOrderDetailController {
  constructor(private readonly labOrdersService: LabOrdersService) {}

  @Get(':id')
  @RequirePermissions(Permission.LAB_ORDER_READ)
  @ResponseMessage('Lab order retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.labOrdersService.findOneForTenant(id, actor);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.LAB_ORDER_CREATE)
  @ResponseMessage('Lab order cancelled successfully.')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.labOrdersService.cancel(id, actor, req.correlationId);
  }
}
