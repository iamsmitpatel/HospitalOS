import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Permission } from '../common/constants/permissions.constants';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { CreateLabResultDto } from './dto/create-lab-result.dto';
import { UpdateLabResultDto } from './dto/update-lab-result.dto';
import { LabResultsService } from './lab-results.service';

@ApiTags('laboratory')
@Controller('lab-results')
export class LabResultsController {
  constructor(private readonly labResultsService: LabResultsService) {}

  @Get(':id')
  @RequirePermissions(Permission.LAB_RESULT_READ)
  @ResponseMessage('Lab result retrieved successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.labResultsService.findOneForTenant(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.LAB_RESULT_ENTER)
  @ResponseMessage('Lab result updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLabResultDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.labResultsService.update(id, dto, actor, req.correlationId);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.LAB_RESULT_VERIFY)
  @ResponseMessage('Lab result verified successfully.')
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.labResultsService.verify(id, actor, req.correlationId);
  }

  @Post(':id/amend')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.LAB_RESULT_ENTER)
  @ResponseMessage('Lab result amended successfully.')
  amend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLabResultDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: RequestWithCorrelationId,
  ) {
    return this.labResultsService.amend(id, dto, actor, req.correlationId);
  }
}
