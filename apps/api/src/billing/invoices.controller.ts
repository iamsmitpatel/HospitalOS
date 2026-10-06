import {
  Body,
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
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceQueryDto } from './dto/invoice-query.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('billing')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @RequirePermissions(Permission.INVOICE_MANAGE)
  @ResponseMessage('Invoice created successfully.')
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.invoicesService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.INVOICE_READ)
  @ResponseMessage('Invoices retrieved successfully.')
  findAll(@Query() query: InvoiceQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.invoicesService.findAllForTenant(actor, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.INVOICE_READ)
  @ResponseMessage('Invoice retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.invoicesService.findOneForTenant(id, actor);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.INVOICE_MANAGE)
  @ResponseMessage('Invoice issued successfully.')
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.invoicesService.issue(id, actor, req.correlationId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.INVOICE_MANAGE)
  @ResponseMessage('Invoice cancelled successfully.')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.invoicesService.cancel(id, actor, req.correlationId);
  }
}
