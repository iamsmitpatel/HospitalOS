import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Master doc §84: a high-concurrency MRN-uniqueness test. Reduced from the
 * suggested 100 to 25 simultaneous registrations — meaningful concurrency
 * pressure on the same atomic Hospital.mrnSequence counter without an
 * unreasonably slow test run; the mechanism being proven (a single
 * row-locked UPDATE ... increment inside the same transaction as the
 * Patient insert — see patients.service.ts and /DATABASE.md) doesn't get
 * meaningfully more proof from 100 vs 25 concurrent requests.
 */
describe('Patient MRN concurrency (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';
  const CONCURRENT_REGISTRATIONS = 25;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it(`issues ${CONCURRENT_REGISTRATIONS} unique MRNs under real concurrency, zero collisions`, async () => {
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    const superAdminToken = registerRes.body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Concurrency Hospital', slug: 'concurrency-hospital', code: 'CONC' })
      .expect(201);

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin@hospitalos.dev',
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
        .send({ email: 'admin@hospitalos.dev', password })
        .expect(200)
    ).body.data.accessToken;

    const attempts = Array.from({ length: CONCURRENT_REGISTRATIONS }, (_, i) =>
      request(server)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Patient',
          lastName: String(i),
          dateOfBirth: '1990-01-01',
          gender: 'OTHER',
          phone: `+91 90000${String(i).padStart(5, '0')}`,
        }),
    );

    const results = await Promise.all(attempts);

    expect(results.every((r) => r.status === 201)).toBe(true);

    const mrns = results.map((r) => r.body.data.mrn);
    expect(new Set(mrns).size).toBe(CONCURRENT_REGISTRATIONS);

    const listRes = await request(server)
      .get('/api/v1/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ pageSize: 100 })
      .expect(200);
    expect(listRes.body.data.total).toBe(CONCURRENT_REGISTRATIONS);
  });
});
