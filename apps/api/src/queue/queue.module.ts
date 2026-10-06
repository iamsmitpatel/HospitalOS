import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { QueuesController } from './queues.controller';
import { QueueEntriesController } from './queue-entries.controller';
import { QueueService } from './queue.service';

@Module({
  imports: [AppointmentsModule],
  controllers: [QueuesController, QueueEntriesController],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
