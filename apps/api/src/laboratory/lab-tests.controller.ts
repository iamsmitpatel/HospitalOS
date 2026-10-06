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
import { CreateLabTestDto } from './dto/create-lab-test.dto';
import { UpdateLabTestDto } from './dto/update-lab-test.dto';
import { LabTestsService } from './lab-tests.service';

@ApiTags('laboratory')
@Controller('lab-tests')
export class LabTestsController {
  constructor(private readonly labTestsService: LabTestsService) {}

  @Post()
  @RequirePermissions(Permission.LABTEST_MANAGE)
  @ResponseMessage('Lab test created successfully.')
  create(
    @Body() dto: CreateLabTestDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.labTestsService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.LABTEST_READ)
  @ResponseMessage('Lab tests retrieved successfully.')
  findAll(@CurrentUser() actor: AuthenticatedUser, @Query('isActive') isActive?: string) {
    const parsed = isActive === undefined ? undefined : isActive === 'true';
    return this.labTestsService.findAllForTenant(actor, parsed);
  }

  @Get(':id')
  @RequirePermissions(Permission.LABTEST_READ)
  @ResponseMessage('Lab test retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.labTestsService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.LABTEST_MANAGE)
  @ResponseMessage('Lab test updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLabTestDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.labTestsService.update(id, dto, actor, req.correlationId);
  }
}
