import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @RequirePermissions(Permission.PAYMENT_MANAGE)
  @ResponseMessage('Payment recorded successfully.')
  create(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.paymentsService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.PAYMENT_READ)
  @ResponseMessage('Payments retrieved successfully.')
  findAll(
    @Query('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paymentsService.listForInvoice(invoiceId, actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.PAYMENT_READ)
  @ResponseMessage('Payment retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.paymentsService.findOneForTenant(id, actor);
  }
}
