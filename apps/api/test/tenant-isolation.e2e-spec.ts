import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Mandatory tenant isolation test (master doc §30): for every tenant-scoped
 * module, Hospital A / Hospital B / User A / User B must satisfy
 *   A -> A = allowed, B -> B = allowed, A -> B = forbidden, B -> A = forbidden.
 * Exercised here through the real HTTP surface (auth + hospitals + users),
 * not by calling services directly, so it proves the guards/services wire
 * together correctly end to end.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';

  let superAdminToken: string;
  let hospitalAId: string;
  let hospitalBId: string;
  let adminAToken: string;
  let adminBToken: string;
  let dataAUserId: string;
  let dataBUserId: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);

    // Bootstrap platform SUPER_ADMIN.
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    superAdminToken = registerRes.body.data.accessToken;

    // Create two tenants.
    const hospitalA = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Hospital A', slug: 'hospital-a', code: 'HOSA' })
      .expect(201);
    hospitalAId = hospitalA.body.data.id;

    const hospitalB = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Hospital B', slug: 'hospital-b', code: 'HOSB' })
      .expect(201);
    hospitalBId = hospitalB.body.data.id;

    // Create a HOSPITAL_ADMIN for each tenant.
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

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin-b@hospitalos.dev',
        password,
        firstName: 'Admin',
        lastName: 'B',
        role: 'HOSPITAL_ADMIN',
        hospitalId: hospitalBId,
      })
      .expect(201);

    const loginA = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin-a@hospitalos.dev', password })
      .expect(200);
    adminAToken = loginA.body.data.accessToken;

    const loginB = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin-b@hospitalos.dev', password })
      .expect(200);
    adminBToken = loginB.body.data.accessToken;

    // Each hospital admin creates one "data" user inside their own tenant.
    // hospitalId is deliberately omitted from the request body to prove the
    // server derives tenant from the caller rather than trusting the client.
    const dataA = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({
        email: 'doctor-a@hospitalos.dev',
        password,
        firstName: 'Doctor',
        lastName: 'A',
        role: 'DOCTOR',
      })
      .expect(201);
    dataAUserId = dataA.body.data.id;
    expect(dataA.body.data.hospitalId).toBe(hospitalAId);

    const dataB = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminBToken}`)
      .send({
        email: 'doctor-b@hospitalos.dev',
        password,
        firstName: 'Doctor',
        lastName: 'B',
        role: 'DOCTOR',
      })
      .expect(201);
    dataBUserId = dataB.body.data.id;
    expect(dataB.body.data.hospitalId).toBe(hospitalBId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('A -> A: hospital admin A can read a user inside hospital A', async () => {
    await request(server)
      .get(`/api/v1/users/${dataAUserId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(200);
  });

  it('B -> B: hospital admin B can read a user inside hospital B', async () => {
    await request(server)
      .get(`/api/v1/users/${dataBUserId}`)
      .set('Authorization', `Bearer ${adminBToken}`)
      .expect(200);
  });

  it('A -> B: hospital admin A cannot read a user inside hospital B', async () => {
    const res = await request(server)
      .get(`/api/v1/users/${dataBUserId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('B -> A: hospital admin B cannot read a user inside hospital A', async () => {
    const res = await request(server)
      .get(`/api/v1/users/${dataAUserId}`)
      .set('Authorization', `Bearer ${adminBToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('user listing is scoped to the caller tenant, not global', async () => {
    const res = await request(server)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(200);

    const ids = res.body.data.map((u: { id: string }) => u.id);
    expect(ids).toContain(dataAUserId);
    expect(ids).not.toContain(dataBUserId);
  });

  it('A -> B: hospital admin A cannot read hospital B itself', async () => {
    const res = await request(server)
      .get(`/api/v1/hospitals/${hospitalBId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('HOSPITAL_NOT_FOUND');
  });

  it('A -> A: hospital admin A can read its own hospital', async () => {
    await request(server)
      .get(`/api/v1/hospitals/${hospitalAId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(200);
  });

  it('a HOSPITAL_ADMIN cannot create another HOSPITAL_ADMIN or SUPER_ADMIN', async () => {
    const res = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({
        email: 'escalation-attempt@hospitalos.dev',
        password,
        firstName: 'Escalation',
        lastName: 'Attempt',
        role: 'HOSPITAL_ADMIN',
      })
      .expect(403);
    expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
  });

  it('a HOSPITAL_ADMIN cannot plant a user into a different hospital via the request body', async () => {
    const res = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({
        email: 'cross-tenant-plant@hospitalos.dev',
        password,
        firstName: 'Cross',
        lastName: 'Tenant',
        role: 'NURSE',
        hospitalId: hospitalBId,
      })
      .expect(201);

    // The client-supplied hospitalId (Hospital B) must be ignored; the user
    // must land in the caller's own tenant (Hospital A).
    expect(res.body.data.hospitalId).toBe(hospitalAId);
  });

  it('only a SUPER_ADMIN can list all hospitals', async () => {
    await request(server)
      .get('/api/v1/hospitals')
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(403);

    const res = await request(server)
      .get('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });
});
