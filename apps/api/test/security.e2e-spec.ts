import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Security E2E checklist (master doc §51): no token, invalid token, expired
 * token, wrong role, and (§32) mass-assignment protection. Cross-tenant
 * access is covered in tenant-isolation.e2e-spec.ts; "wrong role" is also
 * covered more broadly in rbac.e2e-spec.ts — kept here too so every §51
 * case is visible together in one file.
 */
describe('Security (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';
  let accessSecret: string;

  let hospitalAdminToken: string;
  let doctorToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);
    accessSecret = process.env.JWT_ACCESS_SECRET!;

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
    hospitalAdminToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'admin-a@hospitalos.dev', password })
        .expect(200)
    ).body.data.accessToken;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${hospitalAdminToken}`)
      .send({
        email: 'doctor-a@hospitalos.dev',
        password,
        firstName: 'Doc',
        lastName: 'A',
        role: 'DOCTOR',
      })
      .expect(201);
    doctorToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'doctor-a@hospitalos.dev', password })
        .expect(200)
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('no token -> 401', async () => {
    await request(server).get('/api/v1/users').expect(401);
  });

  it('invalid/malformed token -> 401', async () => {
    await request(server)
      .get('/api/v1/users')
      .set('Authorization', 'Bearer this-is-not-a-real-jwt')
      .expect(401);
  });

  it('token signed with the wrong secret -> 401', async () => {
    const forged = jwt.sign(
      { sub: 'nobody', email: 'nobody@hospitalos.dev', role: 'SUPER_ADMIN', hospitalId: null },
      'wrong-secret-entirely',
      { expiresIn: '15m' },
    );
    await request(server).get('/api/v1/users').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('expired token -> 401', async () => {
    const expired = jwt.sign(
      {
        sub: 'nobody',
        email: 'nobody@hospitalos.dev',
        role: 'SUPER_ADMIN',
        hospitalId: null,
        exp: Math.floor(Date.now() / 1000) - 60, // already expired
      },
      accessSecret,
    );
    await request(server)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });

  it('wrong role on an admin-only endpoint -> 403', async () => {
    await request(server)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(403);
  });

  it('mass assignment: unrecognized/privileged fields in the body are rejected, not silently dropped', async () => {
    const res = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${hospitalAdminToken}`)
      .send({
        email: 'escalate@hospitalos.dev',
        password,
        firstName: 'Escalate',
        lastName: 'Attempt',
        role: 'NURSE',
        isSuperAdmin: true, // not a real field — must be rejected by whitelist validation, not ignored
      })
      .expect(400);
    expect(res.body.success).toBe(false);
  });
});
