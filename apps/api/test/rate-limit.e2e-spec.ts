import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Rate limiting (master doc §37). .env.test sets AUTH_THROTTLE_LIMIT=1000 so
 * the rest of the e2e suite isn't throttled by its own request volume — this
 * file overrides it to a small number for just this app instance, then
 * restores the original value in afterAll so later test files in the same
 * Jest worker process are unaffected (process.env is shared within a worker).
 */
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let originalLimit: string | undefined;

  beforeAll(async () => {
    originalLimit = process.env.AUTH_THROTTLE_LIMIT;
    process.env.AUTH_THROTTLE_LIMIT = '3';
    process.env.AUTH_THROTTLE_TTL_SECONDS = '60';

    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
    if (originalLimit === undefined) {
      delete process.env.AUTH_THROTTLE_LIMIT;
    } else {
      process.env.AUTH_THROTTLE_LIMIT = originalLimit;
    }
  });

  it('blocks requests past the configured limit with 429, not an unbounded retry', async () => {
    const attempt = () =>
      request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@hospitalos.dev', password: 'WrongPass123' });

    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await attempt());
    }

    const statuses = results.map((r) => r.status);
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
  });
});
