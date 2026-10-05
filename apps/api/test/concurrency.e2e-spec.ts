import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Mandatory concurrency tests (master doc §18/§52). /auth/register is
 * bootstrap-only in this system (see /DECISIONS.md), so the duplicate-email
 * race is exercised against POST /users — the actual general-purpose user
 * creation endpoint — rather than /auth/register. Both cases prove the
 * database unique constraint (not just the service's findUnique pre-check)
 * is what actually prevents a duplicate under a real race: exactly one
 * request must succeed, the other must receive a clean 409 conflict, never
 * a 500 and never two persisted rows.
 */
describe('Concurrency (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';

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

  it('duplicate email: two simultaneous user-creation requests, exactly one succeeds', async () => {
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    const superAdminToken = registerRes.body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Hospital A', slug: 'hospital-a', code: 'HOSA' })
      .expect(201);

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin-a@hospitalos.dev',
        password,
        firstName: 'Admin',
        lastName: 'A',
        role: 'HOSPITAL_ADMIN',
        hospitalId: hospitalRes.body.data.id,
      })
      .expect(201);
    const adminToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'admin-a@hospitalos.dev', password })
        .expect(200)
    ).body.data.accessToken;

    const duplicateEmail = 'race@hospitalos.dev';
    const attempt = () =>
      request(server).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).send({
        email: duplicateEmail,
        password,
        firstName: 'Race',
        lastName: 'Condition',
        role: 'NURSE',
      });

    const [first, second] = await Promise.all([attempt(), attempt()]);
    const statuses = [first.status, second.status].sort();

    // Exactly one 201, exactly one conflict — never two 201s, never a 500.
    expect(statuses).toEqual([201, 409]);

    const usersRes = await request(server)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const matching = usersRes.body.data.filter(
      (u: { email: string }) => u.email === duplicateEmail,
    );
    expect(matching).toHaveLength(1);
  });

  it('duplicate hospital slug/code: two simultaneous hospital-creation requests, exactly one succeeds', async () => {
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    const superAdminToken = registerRes.body.data.accessToken;

    const attempt = () =>
      request(server)
        .post('/api/v1/hospitals')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: 'Racing Hospital', slug: 'racing-hospital', code: 'RACE' });

    const [first, second] = await Promise.all([attempt(), attempt()]);
    const statuses = [first.status, second.status].sort();

    expect(statuses).toEqual([201, 409]);

    const listRes = await request(server)
      .get('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    const matching = listRes.body.data.filter(
      (h: { slug: string }) => h.slug === 'racing-hospital',
    );
    expect(matching).toHaveLength(1);
  });
});
