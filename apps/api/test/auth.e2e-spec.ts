import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

function extractRefreshCookie(setCookieHeader: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const raw = cookies.find((c) => c.startsWith('refresh_token='));
  if (!raw) {
    throw new Error('refresh_token cookie not found in Set-Cookie header');
  }
  return raw.split(';')[0];
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  const strongPassword = 'TestPass123';

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('bootstraps the first SUPER_ADMIN via /auth/register', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'root@hospitalos.dev',
        password: strongPassword,
        firstName: 'Root',
        lastName: 'Admin',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.role).toBe('SUPER_ADMIN');
    expect(res.body.data.user.hospitalId).toBeNull();
    expect(res.headers['set-cookie']?.[0]).toMatch(/refresh_token=/);
  });

  it('closes registration after the first user exists', async () => {
    await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'root@hospitalos.dev',
        password: strongPassword,
        firstName: 'Root',
        lastName: 'Admin',
      })
      .expect(201);

    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'second@hospitalos.dev',
        password: strongPassword,
        firstName: 'Second',
        lastName: 'User',
      })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
  });

  it('rejects login with the wrong password using a generic error', async () => {
    await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'root@hospitalos.dev',
        password: strongPassword,
        firstName: 'Root',
        lastName: 'Admin',
      })
      .expect(201);

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'root@hospitalos.dev', password: 'WrongPass123' })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects login for a nonexistent email with the same generic error', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@hospitalos.dev', password: strongPassword })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    await request(server).get('/api/v1/auth/me').expect(401);
  });

  it('completes the full login -> me -> refresh -> logout -> refresh-fails cycle', async () => {
    await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'root@hospitalos.dev',
        password: strongPassword,
        firstName: 'Root',
        lastName: 'Admin',
      })
      .expect(201);

    const agent = request.agent(server);

    const loginRes = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'root@hospitalos.dev', password: strongPassword })
      .expect(200);

    const accessToken = loginRes.body.data.accessToken;

    const meRes = await agent
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(meRes.body.data.email).toBe('root@hospitalos.dev');

    const refreshRes = await agent.post('/api/v1/auth/refresh').expect(200);
    const newAccessToken = refreshRes.body.data.accessToken;
    expect(newAccessToken).toBeDefined();
    expect(newAccessToken).not.toBe(accessToken);

    await agent.post('/api/v1/auth/logout').expect(200);

    // Presenting the (now revoked) refresh cookie again must fail, not silently succeed.
    await agent.post('/api/v1/auth/refresh').expect(401);
  });

  it('detects refresh-token reuse and revokes the session', async () => {
    await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'root@hospitalos.dev',
        password: strongPassword,
        firstName: 'Root',
        lastName: 'Admin',
      })
      .expect(201);

    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'root@hospitalos.dev', password: strongPassword })
      .expect(200);
    const originalCookie = extractRefreshCookie(loginRes.headers['set-cookie']);

    // First refresh rotates the token (old one becomes revoked).
    const firstRefresh = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(200);
    const rotatedCookie = extractRefreshCookie(firstRefresh.headers['set-cookie']);

    // Replaying the original (now-revoked) refresh cookie must be rejected.
    const replay = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // And the rotated token from the legitimate first refresh should now be
    // revoked too, since reuse revokes the whole chain for this user.
    await request(server).post('/api/v1/auth/refresh').set('Cookie', rotatedCookie).expect(401);
  });
});
