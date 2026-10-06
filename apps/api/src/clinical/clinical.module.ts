import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { EncountersController } from './encounters.controller';
import { DiagnosesController } from './diagnoses.controller';
import { PrescriptionsController } from './prescriptions.controller';
import { EncountersService } from './encounters.service';
import { VitalsService } from './vitals.service';
import { ClinicalNotesService } from './clinical-notes.service';
import { DiagnosesService } from './diagnoses.service';
import { PrescriptionsService } from './prescriptions.service';

@Module({
  imports: [PatientsModule, DoctorsModule, AppointmentsModule],
  controllers: [EncountersController, DiagnosesController, PrescriptionsController],
  providers: [
    EncountersService,
    VitalsService,
    ClinicalNotesService,
    DiagnosesService,
    PrescriptionsService,
  ],
  exports: [EncountersService, PrescriptionsService],
})
export class ClinicalModule {}
