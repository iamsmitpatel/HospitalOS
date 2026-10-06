import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditOutcome } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import {
  NOTIFICATION_PROVIDER,
  NotificationChannel,
  NotificationProvider,
} from './notification-provider.interface';

export interface NotifyParams {
  /** Short machine-readable label for what triggered this, e.g. "APPOINTMENT_BOOKED". Stored in metadata and as resourceId, not a fixed enum — new trigger points should not require a migration. */
  type: string;
  channel: NotificationChannel;
  to: string;
  subject?: string;
  body: string;
  hospitalId: string;
  /** Who the notification is FOR — recorded in metadata only (not a FK), since it's the recipient, not the actor. */
  recipientUserId?: string;
  /** Who/what triggered the underlying event, if there's a real actor (a staff member, a Connect patient). Maps to AuditLog.actorUserId, which has a real FK — never pass a synthetic id here. */
  triggeredByUserId?: string;
  correlationId?: string;
}

/**
 * The single call site every trigger point (booking, cancellation, queue
 * call-next, lab result verification, invoice issuance, ...) should use.
 * Failures are deliberately swallowed after being recorded — a notification
 * provider outage must never roll back or fail the business transaction
 * that triggered it. See /DECISIONS.md.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
    private readonly auditService: AuditService,
  ) {}

  async notify(params: NotifyParams): Promise<void> {
    const metadata = {
      channel: params.channel,
      provider: this.provider.name,
      type: params.type,
      recipientUserId: params.recipientUserId,
    };

    try {
      await this.provider.send({
        to: params.to,
        channel: params.channel,
        subject: params.subject,
        body: params.body,
      });

      await this.auditService.log({
        action: AuditAction.NOTIFICATION_SENT,
        outcome: AuditOutcome.SUCCESS,
        actorUserId: params.triggeredByUserId,
        hospitalId: params.hospitalId,
        resourceType: 'Notification',
        resourceId: params.type,
        correlationId: params.correlationId,
        metadata,
      });
    } catch (error) {
      this.logger.error(`Notification failed (${params.type}): ${(error as Error).message}`);
      await this.auditService.log({
        action: AuditAction.NOTIFICATION_FAILED,
        outcome: AuditOutcome.FAILURE,
        actorUserId: params.triggeredByUserId,
        hospitalId: params.hospitalId,
        resourceType: 'Notification',
        resourceId: params.type,
        correlationId: params.correlationId,
        metadata: { ...metadata, error: (error as Error).message },
      });
    }
  }
}
