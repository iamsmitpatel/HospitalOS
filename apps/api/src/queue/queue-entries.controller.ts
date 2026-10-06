import {
  Body,
  Controller,
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
import { CreateQueueEntryDto } from './dto/create-queue-entry.dto';
import { QueueService } from './queue.service';

@ApiTags('queue-entries')
@Controller('queue-entries')
export class QueueEntriesController {
  constructor(private readonly queueService: QueueService) {}

  @Post()
  @RequirePermissions(Permission.QUEUE_OPERATE)
  @ResponseMessage('Checked in successfully.')
  checkIn(
    @Body() dto: CreateQueueEntryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.queueService.checkIn(dto, actor, req.correlationId);
  }

  @Post(':id/skip')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.QUEUE_OPERATE)
  @ResponseMessage('Queue entry skipped.')
  skip(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.queueService.skip(id, actor, req.correlationId);
  }

  @Post(':id/requeue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.QUEUE_OPERATE)
  @ResponseMessage('Queue entry requeued.')
  requeue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.queueService.requeue(id, actor, req.correlationId);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.QUEUE_OPERATE)
  @ResponseMessage('Consultation started.')
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.queueService.startConsultation(id, actor, req.correlationId);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.QUEUE_OPERATE)
  @ResponseMessage('Queue entry completed.')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.queueService.complete(id, actor, req.correlationId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.QUEUE_OPERATE)
  @ResponseMessage('Queue entry cancelled.')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.queueService.cancel(id, actor, req.correlationId);
  }
}
