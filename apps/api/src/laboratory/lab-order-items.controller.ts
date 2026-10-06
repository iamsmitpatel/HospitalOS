import { Body, Controller, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CollectSpecimenDto } from './dto/collect-specimen.dto';
import { CreateLabResultDto } from './dto/create-lab-result.dto';
import { LabOrdersService } from './lab-orders.service';
import { LabResultsService } from './lab-results.service';

@ApiTags('laboratory')
@Controller('lab-order-items')
export class LabOrderItemsController {
  constructor(
    private readonly labOrdersService: LabOrdersService,
    private readonly labResultsService: LabResultsService,
  ) {}

  @Post(':id/collect')
  @RequirePermissions(Permission.LAB_ORDER_PROCESS)
  @ResponseMessage('Specimen collected successfully.')
  collect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectSpecimenDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.labOrdersService.collectSpecimen(id, dto, actor, req.correlationId);
  }

  @Post(':id/result')
  @RequirePermissions(Permission.LAB_RESULT_ENTER)
  @ResponseMessage('Lab result entered successfully.')
  enterResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLabResultDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.labResultsService.create(id, dto, actor, req.correlationId);
  }
}
