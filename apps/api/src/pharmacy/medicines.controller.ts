import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { MedicinesService } from './medicines.service';
import { StockBatchesService } from './stock-batches.service';

@ApiTags('pharmacy')
@Controller('medicines')
export class MedicinesController {
  constructor(
    private readonly medicinesService: MedicinesService,
    private readonly stockBatchesService: StockBatchesService,
  ) {}

  @Post()
  @RequirePermissions(Permission.MEDICINE_MANAGE)
  @ResponseMessage('Medicine created successfully.')
  create(
    @Body() dto: CreateMedicineDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.medicinesService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.MEDICINE_READ)
  @ResponseMessage('Medicines retrieved successfully.')
  findAll(@CurrentUser() actor: AuthenticatedUser, @Query('isActive') isActive?: string) {
    const parsed = isActive === undefined ? undefined : isActive === 'true';
    return this.medicinesService.findAllForTenant(actor, parsed);
  }

  @Get(':id')
  @RequirePermissions(Permission.MEDICINE_READ)
  @ResponseMessage('Medicine retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.medicinesService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.MEDICINE_MANAGE)
  @ResponseMessage('Medicine updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicineDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.medicinesService.update(id, dto, actor, req.correlationId);
  }

  @Post(':id/stock-batches')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  @ResponseMessage('Stock received successfully.')
  receiveStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveStockDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.stockBatchesService.receiveStock(id, dto, actor, req.correlationId);
  }

  @Get(':id/stock-batches')
  @RequirePermissions(Permission.INVENTORY_READ)
  @ResponseMessage('Stock batches retrieved successfully.')
  listStockBatches(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.stockBatchesService.listForMedicine(id, actor);
  }

  @Get(':id/stock-movements')
  @RequirePermissions(Permission.INVENTORY_READ)
  @ResponseMessage('Stock movements retrieved successfully.')
  listStockMovements(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.stockBatchesService.listMovementsForMedicine(id, actor);
  }
}
