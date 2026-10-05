import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
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
  @Roles(Role.HOSPITAL_ADMIN)
  @ResponseMessage('User created successfully.')
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.usersService.create(dto, actor, req.correlationId);
  }

  @Get()
  @Roles(Role.HOSPITAL_ADMIN)
  @ResponseMessage('Users retrieved successfully.')
  findAll(@CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.findAllForTenant(actor);
  }

  @Get(':id')
  @Roles(Role.HOSPITAL_ADMIN)
  @ResponseMessage('User retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @Roles(Role.HOSPITAL_ADMIN)
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
