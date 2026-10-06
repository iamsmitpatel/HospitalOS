import { Module } from '@nestjs/common';
import { MedicinesController } from './medicines.controller';
import { StockBatchesController } from './stock-batches.controller';
import { DispenseController } from './dispense.controller';
import { MedicinesService } from './medicines.service';
import { StockBatchesService } from './stock-batches.service';
import { DispenseService } from './dispense.service';

@Module({
  controllers: [MedicinesController, StockBatchesController, DispenseController],
  providers: [MedicinesService, StockBatchesService, DispenseService],
  exports: [MedicinesService, StockBatchesService],
})
export class PharmacyModule {}
