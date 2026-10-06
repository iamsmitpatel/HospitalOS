import { Module } from '@nestjs/common';
import { DoctorsModule } from '../doctors/doctors.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { PatientsModule } from '../patients/patients.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { PatientController } from './patient.controller';
import { PatientQueueService } from './patient-queue.service';
import { PatientMedicalRecordsService } from './patient-medical-records.service';

@Module({
  imports: [DoctorsModule, AppointmentsModule, PatientsModule],
  controllers: [DiscoveryController, PatientController],
  providers: [DiscoveryService, PatientQueueService, PatientMedicalRecordsService],
})
export class ConnectModule {}
