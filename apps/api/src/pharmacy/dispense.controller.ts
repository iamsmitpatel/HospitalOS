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
import { CreateDispenseDto } from './dto/create-dispense.dto';
import { ReturnStockDto } from './dto/return-stock.dto';
import { DispenseService } from './dispense.service';

@ApiTags('pharmacy')
@Controller('dispense-records')
export class DispenseController {
  constructor(private readonly dispenseService: DispenseService) {}

  @Post()
  @RequirePermissions(Permission.PHARMACY_DISPENSE)
  @ResponseMessage('Medicine dispensed successfully.')
  create(
    @Body() dto: CreateDispenseDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.dispenseService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.PHARMACY_DISPENSE)
  @ResponseMessage('Dispense records retrieved successfully.')
  findAll(
    @Query('prescriptionItemId', ParseUUIDPipe) prescriptionItemId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.dispenseService.listForPrescriptionItem(prescriptionItemId, actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.PHARMACY_DISPENSE)
  @ResponseMessage('Dispense record retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.dispenseService.findOneForTenant(id, actor);
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PHARMACY_DISPENSE)
  @ResponseMessage('Stock returned successfully.')
  returnStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnStockDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.dispenseService.returnStock(id, dto, actor, req.correlationId);
  }
}
