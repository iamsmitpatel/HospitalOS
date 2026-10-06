import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('renders an empty-but-valid exposition document before any request is recorded', () => {
    const text = service.renderPrometheusText();
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('# TYPE http_request_duration_seconds_sum counter');
  });

  it('accumulates counts per (method, route, status) rather than per raw URL', () => {
    service.recordRequest('GET', '/patient/appointments/:id', 200, 0.01);
    service.recordRequest('GET', '/patient/appointments/:id', 200, 0.02);
    service.recordRequest('GET', '/patient/appointments/:id', 404, 0.005);

    const text = service.renderPrometheusText();
    expect(text).toContain(
      'http_requests_total{method="GET",route="/patient/appointments/:id",status="200"} 2',
    );
    expect(text).toContain(
      'http_requests_total{method="GET",route="/patient/appointments/:id",status="404"} 1',
    );
  });

  it('sums duration across all statuses for the same (method, route)', () => {
    service.recordRequest('GET', '/discover/hospitals', 200, 0.1);
    service.recordRequest('GET', '/discover/hospitals', 500, 0.2);

    const text = service.renderPrometheusText();
    expect(text).toContain(
      'http_request_duration_seconds_sum{method="GET",route="/discover/hospitals"} 0.300000',
    );
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/discover/hospitals"} 2',
    );
  });
});
