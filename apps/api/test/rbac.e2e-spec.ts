import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Mandatory RBAC matrix (master doc §29): a representative staff-admin-only
 * endpoint (GET /users) and a representative platform-admin-only endpoint
 * (POST /hospitals), exercised by every role plus an unauthenticated caller.
 * Complements tenant-isolation.e2e-spec.ts, which covers the A/B tenant
 * matrix specifically — this file covers "which roles may call this route
 * at all," independent of tenant.
 */
describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';

  let superAdminToken: string;
  let hospitalAId: string;
  let hospitalAdminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let patientToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);

    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    superAdminToken = registerRes.body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Hospital A', slug: 'hospital-a', code: 'HOSA' })
      .expect(201);
    hospitalAId = hospitalRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin-a@hospitalos.dev',
        password,
        firstName: 'Admin',
        lastName: 'A',
        role: 'HOSPITAL_ADMIN',
        hospitalId: hospitalAId,
      })
      .expect(201);
    hospitalAdminToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'admin-a@hospitalos.dev', password })
        .expect(200)
    ).body.data.accessToken;

    for (const [email, role, bucket] of [
      ['doctor-a@hospitalos.dev', 'DOCTOR', 'doctor'],
      ['reception-a@hospitalos.dev', 'RECEPTIONIST', 'receptionist'],
      ['patient-a@hospitalos.dev', 'PATIENT', 'patient'],
    ] as const) {
      await request(server)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${hospitalAdminToken}`)
        .send({ email, password, firstName: 'Test', lastName: bucket, role })
        .expect(201);
      const loginRes = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      const token = loginRes.body.data.accessToken;
      if (bucket === 'doctor') doctorToken = token;
      if (bucket === 'receptionist') receptionistToken = token;
      if (bucket === 'patient') patientToken = token;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('staff-admin-only endpoint: GET /api/v1/users', () => {
    it('HOSPITAL_ADMIN -> allowed', async () => {
      await request(server)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${hospitalAdminToken}`)
        .expect(200);
    });

    it('DOCTOR -> denied (403)', async () => {
      await request(server)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(403);
    });

    it('RECEPTIONIST -> denied (403)', async () => {
      await request(server)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);
    });

    it('PATIENT -> denied (403)', async () => {
      await request(server)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(403);
    });

    it('unauthenticated -> denied (401)', async () => {
      await request(server).get('/api/v1/users').expect(401);
    });
  });

  describe('platform-admin-only endpoint: POST /api/v1/hospitals', () => {
    const newHospital = { name: 'Hospital Z', slug: 'hospital-z', code: 'HOSZ' };

    it('SUPER_ADMIN -> allowed', async () => {
      await request(server)
        .post('/api/v1/hospitals')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(newHospital)
        .expect(201);
    });

    it('HOSPITAL_ADMIN -> denied (403) — hospital admin is tenant-scoped, not platform-level', async () => {
      await request(server)
        .post('/api/v1/hospitals')
        .set('Authorization', `Bearer ${hospitalAdminToken}`)
        .send({ name: 'Hospital Y', slug: 'hospital-y', code: 'HOSY' })
        .expect(403);
    });

    it('DOCTOR -> denied (403)', async () => {
      await request(server)
        .post('/api/v1/hospitals')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ name: 'Hospital X', slug: 'hospital-x', code: 'HOSX' })
        .expect(403);
    });

    it('unauthenticated -> denied (401)', async () => {
      await request(server).post('/api/v1/hospitals').send(newHospital).expect(401);
    });
  });
});
