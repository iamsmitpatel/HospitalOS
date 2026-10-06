import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { InvoicesController } from './invoices.controller';
import { ServicesService } from './services.service';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [ServicesController, InvoicesController],
  providers: [ServicesService, InvoicesService],
  exports: [ServicesService, InvoicesService],
})
export class BillingModule {}
