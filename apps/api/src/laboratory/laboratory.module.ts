import { Module } from '@nestjs/common';
import { ClinicalModule } from '../clinical/clinical.module';
import { LabTestsController } from './lab-tests.controller';
import { LabOrdersController } from './lab-orders.controller';
import { LabOrderDetailController } from './lab-order-detail.controller';
import { LabOrderItemsController } from './lab-order-items.controller';
import { LabResultsController } from './lab-results.controller';
import { LabTestsService } from './lab-tests.service';
import { LabOrdersService } from './lab-orders.service';
import { LabResultsService } from './lab-results.service';

@Module({
  imports: [ClinicalModule],
  controllers: [
    LabTestsController,
    LabOrdersController,
    LabOrderDetailController,
    LabOrderItemsController,
    LabResultsController,
  ],
  providers: [LabTestsService, LabOrdersService, LabResultsService],
  exports: [LabTestsService, LabOrdersService],
})
export class LaboratoryModule {}
