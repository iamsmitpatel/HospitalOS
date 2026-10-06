import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { QueueQueryDto } from './dto/queue-query.dto';
import { QueueService } from './queue.service';

@ApiTags('queues')
@Controller('queues')
export class QueuesController {
  constructor(private readonly queueService: QueueService) {}

  @Get()
  @RequirePermissions(Permission.QUEUE_READ)
  @ResponseMessage('Queues retrieved successfully.')
  findAll(@Query() query: QueueQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.queueService.findQueuesForTenant(actor, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.QUEUE_READ)
  @ResponseMessage('Queue retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.queueService.findQueueForTenant(id, actor);
  }

  @Post(':id/call-next')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.QUEUE_OPERATE)
  @ResponseMessage('Next patient called successfully.')
  callNext(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.queueService.callNext(id, actor, req.correlationId);
  }
}
