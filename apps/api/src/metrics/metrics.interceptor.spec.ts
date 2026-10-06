import { of } from 'rxjs';
import { EventEmitter } from 'node:events';
import { MetricsInterceptor } from './metrics.interceptor';

describe('MetricsInterceptor', () => {
  it('records the request only once the response actually finishes, using its final statusCode', () => {
    const metricsService = { recordRequest: jest.fn() };
    const interceptor = new MetricsInterceptor(metricsService as never);

    const request = {
      method: 'POST',
      route: { path: '/patient/appointments' },
      url: '/patient/appointments/abc-123',
    };
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = 200; // Express's default, before Nest sets the real @HttpCode

    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    };
    const next = { handle: () => of('ignored') };

    interceptor.intercept(context as never, next as never);
    expect(metricsService.recordRequest).not.toHaveBeenCalled();

    // Simulate Nest setting the real status code after the interceptor ran,
    // then the response actually finishing — the exact ordering this
    // interceptor is designed around.
    response.statusCode = 201;
    response.emit('finish');

    expect(metricsService.recordRequest).toHaveBeenCalledWith(
      'POST',
      '/patient/appointments',
      201,
      expect.any(Number),
    );
  });

  it('falls back to the raw URL when Express has not attached a route (should not happen in practice, but must not throw)', () => {
    const metricsService = { recordRequest: jest.fn() };
    const interceptor = new MetricsInterceptor(metricsService as never);

    const request = { method: 'GET', url: '/unmatched' };
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = 404;

    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    };
    const next = { handle: () => of('ignored') };

    interceptor.intercept(context as never, next as never);
    response.emit('finish');

    expect(metricsService.recordRequest).toHaveBeenCalledWith(
      'GET',
      '/unmatched',
      404,
      expect.any(Number),
    );
  });

  it('skips non-HTTP contexts (e.g. a future RPC/WS transport) entirely', () => {
    const metricsService = { recordRequest: jest.fn() };
    const interceptor = new MetricsInterceptor(metricsService as never);
    const context = { getType: () => 'rpc' };
    const next = { handle: () => of('ignored') };

    interceptor.intercept(context as never, next as never);

    expect(metricsService.recordRequest).not.toHaveBeenCalled();
  });
});
