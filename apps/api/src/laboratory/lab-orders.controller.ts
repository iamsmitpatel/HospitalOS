import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateLabOrderDto } from './dto/create-lab-order.dto';
import { LabOrdersService } from './lab-orders.service';

/** Nested under /encounters, same convention as doctors.controller.ts's schedules routes. */
@ApiTags('laboratory')
@Controller('encounters')
export class LabOrdersController {
  constructor(private readonly labOrdersService: LabOrdersService) {}

  @Post(':id/lab-orders')
  @RequirePermissions(Permission.LAB_ORDER_CREATE)
  @ResponseMessage('Lab order created successfully.')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLabOrderDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.labOrdersService.create(id, dto, actor, req.correlationId);
  }

  @Get(':id/lab-orders')
  @RequirePermissions(Permission.LAB_ORDER_READ)
  @ResponseMessage('Lab orders retrieved successfully.')
  findAll(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.labOrdersService.listForEncounter(id, actor);
  }
}
