import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { DiscoverHospitalsQueryDto } from './dto/discover-hospitals-query.dto';
import { DiscoverDoctorsQueryDto } from './dto/discover-doctors-query.dto';
import { AvailableSlotsQueryDto } from '../doctors/dto/available-slots-query.dto';
import { DiscoveryService } from './discovery.service';

/** Every route here is @Public() — see discovery.service.ts for the exact visibility gate. */
@ApiTags('discover')
@Controller('discover')
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Public()
  @Get('hospitals')
  @ResponseMessage('Hospitals retrieved successfully.')
  listHospitals(@Query() query: DiscoverHospitalsQueryDto) {
    return this.discoveryService.listHospitals(query);
  }

  @Public()
  @Get('hospitals/:id')
  @ResponseMessage('Hospital retrieved successfully.')
  getHospital(@Param('id', ParseUUIDPipe) id: string) {
    return this.discoveryService.getHospital(id);
  }

  @Public()
  @Get('hospitals/:id/departments')
  @ResponseMessage('Departments retrieved successfully.')
  listDepartments(@Param('id', ParseUUIDPipe) id: string) {
    return this.discoveryService.listDepartments(id);
  }

  @Public()
  @Get('hospitals/:id/doctors')
  @ResponseMessage('Doctors retrieved successfully.')
  listDoctors(@Param('id', ParseUUIDPipe) id: string, @Query() query: DiscoverDoctorsQueryDto) {
    return this.discoveryService.listDoctors(id, query);
  }

  @Public()
  @Get('doctors/:id')
  @ResponseMessage('Doctor retrieved successfully.')
  getDoctor(@Param('id', ParseUUIDPipe) id: string) {
    return this.discoveryService.getDoctor(id);
  }

  @Public()
  @Get('doctors/:id/available-slots')
  @ResponseMessage('Available slots retrieved successfully.')
  getAvailableSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AvailableSlotsQueryDto,
  ) {
    return this.discoveryService.getAvailableSlots(id, query.date);
  }
}
