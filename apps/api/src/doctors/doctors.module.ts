import { Module } from '@nestjs/common';
import { DepartmentsModule } from '../departments/departments.module';
import { DoctorsController } from './doctors.controller';
import { SchedulesController } from './schedules.controller';
import { DoctorsService } from './doctors.service';

@Module({
  imports: [DepartmentsModule],
  controllers: [DoctorsController, SchedulesController],
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}
