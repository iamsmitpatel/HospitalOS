import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let provider: any;
  let auditService: any;
  let service: NotificationsService;

  const baseParams = {
    type: 'APPOINTMENT_BOOKED',
    channel: 'EMAIL' as const,
    to: 'patient@example.com',
    body: 'Your appointment is confirmed.',
    hospitalId: 'hospital-a',
    recipientUserId: 'connect-1',
    triggeredByUserId: 'connect-1',
  };

  beforeEach(() => {
    provider = { name: 'log', send: jest.fn().mockResolvedValue(undefined) };
    auditService = { log: jest.fn() };
    service = new NotificationsService(provider, auditService);
  });

  it('sends via the injected provider and records a NOTIFICATION_SENT audit entry on success', async () => {
    await service.notify(baseParams);

    expect(provider.send).toHaveBeenCalledWith({
      to: baseParams.to,
      channel: 'EMAIL',
      subject: undefined,
      body: baseParams.body,
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'NOTIFICATION_SENT',
        outcome: 'SUCCESS',
        hospitalId: 'hospital-a',
        actorUserId: 'connect-1',
      }),
    );
  });

  it('never throws when the provider fails, and records a NOTIFICATION_FAILED audit entry instead', async () => {
    provider.send.mockRejectedValue(new Error('provider unreachable'));

    await expect(service.notify(baseParams)).resolves.toBeUndefined();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'NOTIFICATION_FAILED',
        outcome: 'FAILURE',
        metadata: expect.objectContaining({ error: 'provider unreachable' }),
      }),
    );
  });

  it('never stores a synthetic actorUserId — only a real triggeredByUserId or undefined', async () => {
    await service.notify({ ...baseParams, triggeredByUserId: undefined });

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: undefined }),
    );
  });
});
