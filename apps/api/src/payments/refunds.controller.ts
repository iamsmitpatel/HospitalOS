import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateRefundDto } from './dto/create-refund.dto';
import { RefundsService } from './refunds.service';

@ApiTags('payments')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post()
  @RequirePermissions(Permission.PAYMENT_REFUND)
  @ResponseMessage('Refund recorded successfully.')
  create(
    @Body() dto: CreateRefundDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.refundsService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.PAYMENT_READ)
  @ResponseMessage('Refunds retrieved successfully.')
  findAll(
    @Query('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.refundsService.listForInvoice(invoiceId, actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.PAYMENT_READ)
  @ResponseMessage('Refund retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.refundsService.findOneForTenant(id, actor);
  }
}
