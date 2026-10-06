import {
  Body,
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
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StockBatchesService } from './stock-batches.service';

/** Flat route, same reasoning as schedules.controller.ts — logic lives in StockBatchesService. */
@ApiTags('pharmacy')
@Controller('stock-batches')
export class StockBatchesController {
  constructor(private readonly stockBatchesService: StockBatchesService) {}

  @Get(':id')
  @RequirePermissions(Permission.INVENTORY_READ)
  @ResponseMessage('Stock batch retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.stockBatchesService.findOneForTenant(id, actor);
  }

  @Post(':id/adjust')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  @ResponseMessage('Stock adjusted successfully.')
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.stockBatchesService.adjust(id, dto, actor, req.correlationId);
  }

  @Post(':id/mark-expired')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  @ResponseMessage('Batch marked as expired successfully.')
  markExpired(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.stockBatchesService.markExpired(id, actor, req.correlationId);
  }
}
