import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { LogNotificationProvider } from './log-notification.provider';
import { NOTIFICATION_PROVIDER } from './notification-provider.interface';

@Module({
  providers: [
    NotificationsService,
    { provide: NOTIFICATION_PROVIDER, useClass: LogNotificationProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
