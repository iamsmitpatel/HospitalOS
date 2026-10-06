import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { DepartmentsService } from './departments.service';

@ApiTags('departments')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @RequirePermissions(Permission.DEPARTMENT_CREATE)
  @ResponseMessage('Department created successfully.')
  create(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.departmentsService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.DEPARTMENT_READ)
  @ResponseMessage('Departments retrieved successfully.')
  findAll(@CurrentUser() actor: AuthenticatedUser) {
    return this.departmentsService.findAllForTenant(actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.DEPARTMENT_READ)
  @ResponseMessage('Department retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.departmentsService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DEPARTMENT_UPDATE)
  @ResponseMessage('Department updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.departmentsService.update(id, dto, actor, req.correlationId);
  }
}
