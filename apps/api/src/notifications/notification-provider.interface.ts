export type NotificationChannel = 'EMAIL' | 'SMS';

export interface NotificationMessage {
  to: string;
  channel: NotificationChannel;
  subject?: string;
  body: string;
}

/**
 * Deliberately provider-neutral (master doc "notification system
 * architecture"): NotificationsService depends on this interface only, never
 * on a concrete vendor SDK. Swapping LogNotificationProvider for a real
 * SendGrid/Twilio-backed implementation later is a one-line change in
 * notifications.module.ts — see /DECISIONS.md and /SECURITY.md.
 */
export interface NotificationProvider {
  readonly name: string;
  send(message: NotificationMessage): Promise<void>;
}

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');
