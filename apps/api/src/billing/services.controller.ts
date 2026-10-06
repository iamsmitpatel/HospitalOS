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
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { SetServicePriceDto } from './dto/set-service-price.dto';
import { ServicesService } from './services.service';

@ApiTags('billing')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @RequirePermissions(Permission.SERVICE_MANAGE)
  @ResponseMessage('Service created successfully.')
  create(
    @Body() dto: CreateServiceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.servicesService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.SERVICE_READ)
  @ResponseMessage('Services retrieved successfully.')
  findAll(@CurrentUser() actor: AuthenticatedUser, @Query('isActive') isActive?: string) {
    const parsed = isActive === undefined ? undefined : isActive === 'true';
    return this.servicesService.findAllForTenant(actor, parsed);
  }

  @Get(':id')
  @RequirePermissions(Permission.SERVICE_READ)
  @ResponseMessage('Service retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.servicesService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.SERVICE_MANAGE)
  @ResponseMessage('Service updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.servicesService.update(id, dto, actor, req.correlationId);
  }

  @Post(':id/prices')
  @RequirePermissions(Permission.SERVICE_MANAGE)
  @ResponseMessage('Service price set successfully.')
  setPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetServicePriceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.servicesService.setPrice(id, dto, actor, req.correlationId);
  }

  @Get(':id/prices')
  @RequirePermissions(Permission.SERVICE_READ)
  @ResponseMessage('Price history retrieved successfully.')
  listPrices(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.servicesService.listPriceHistory(id, actor);
  }
}
