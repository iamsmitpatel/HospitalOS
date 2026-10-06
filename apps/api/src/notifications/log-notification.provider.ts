import { Injectable, Logger } from '@nestjs/common';
import { NotificationMessage, NotificationProvider } from './notification-provider.interface';

/**
 * The only concrete provider wired up in this environment — there is no
 * email/SMS vendor account or credentials available to send anything real.
 * This is an honest placeholder, not a delivery integration: it proves the
 * NotificationsService -> NotificationProvider boundary works end to end,
 * and gives ops a searchable trail (combined with the AuditLog entry
 * NotificationsService writes alongside every send) without ever claiming
 * a message left the building. See /DECISIONS.md and the Phase 5 report.
 */
@Injectable()
export class LogNotificationProvider implements NotificationProvider {
  readonly name = 'log';
  private readonly logger = new Logger('Notification');

  async send(message: NotificationMessage): Promise<void> {
    this.logger.log(
      `[${message.channel}] to=${message.to}${message.subject ? ` subject="${message.subject}"` : ''} body="${message.body}"`,
    );
  }
}
