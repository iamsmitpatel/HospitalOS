import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { HospitalsService } from './hospitals.service';

@ApiTags('hospitals')
@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Post()
  @RequirePermissions(Permission.HOSPITAL_CREATE)
  @ResponseMessage('Hospital created successfully.')
  create(
    @Body() dto: CreateHospitalDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.hospitalsService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.HOSPITAL_LIST)
  @ResponseMessage('Hospitals retrieved successfully.')
  findAll(@CurrentUser() actor: AuthenticatedUser) {
    return this.hospitalsService.findAll(actor);
  }

  @Get(':id')
  @ResponseMessage('Hospital retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.hospitalsService.findOne(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.HOSPITAL_UPDATE)
  @ResponseMessage('Hospital updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHospitalDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.hospitalsService.update(id, dto, actor, req.correlationId);
  }
}
