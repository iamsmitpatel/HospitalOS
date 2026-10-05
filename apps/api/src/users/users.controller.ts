import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions(Permission.USER_CREATE)
  @ResponseMessage('User created successfully.')
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.usersService.create(dto, actor, req.correlationId);
  }

  @Get()
  @RequirePermissions(Permission.USER_READ)
  @ResponseMessage('Users retrieved successfully.')
  findAll(@CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.findAllForTenant(actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.USER_READ)
  @ResponseMessage('User retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.USER_UPDATE)
  @ResponseMessage('User updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.usersService.update(id, dto, actor, req.correlationId);
  }
}
