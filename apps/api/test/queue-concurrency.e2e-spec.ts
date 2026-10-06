import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Master doc §86: multiple waiting patients, multiple simultaneous
 * call-next requests. Proves the FOR UPDATE SKIP LOCKED claim in
 * queue.service.ts#callNext (see /DATABASE.md) hands out distinct entries
 * under real concurrency — no two callers get the same patient, and a
 * call-next once nobody is left waiting gets a controlled response, not a
 * crash or a silently-empty success.
 */
describe('Queue call-next concurrency (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';
  const WAITING_PATIENTS = 5;
  const SLOTS = ['03:30', '03:45', '04:00', '04:15', '04:30'].map((t) => `2027-10-11T${t}:00.000Z`);

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('5 simultaneous call-next requests against 5 waiting entries each claim a distinct entry', async () => {
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    const superAdminToken = registerRes.body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Queue Hospital', slug: 'queue-hospital', code: 'QUEU' })
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

    const deptRes = await request(server)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cardiology', code: 'CARD' })
      .expect(201);

    const doctorUserRes = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'doctor@hospitalos.dev',
        password,
        firstName: 'Doc',
        lastName: 'A',
        role: 'DOCTOR',
      })
      .expect(201);

    const doctorRes = await request(server)
      .post('/api/v1/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: doctorUserRes.body.data.id,
        departmentId: deptRes.body.data.id,
        specialization: 'Cardiology',
      })
      .expect(201);
    const doctorId = doctorRes.body.data.id;

    await request(server)
      .post(`/api/v1/doctors/${doctorId}/schedules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 15 })
      .expect(201);

    let queueId = '';
    for (let i = 0; i < WAITING_PATIENTS; i += 1) {
      const patientRes = await request(server)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Patient',
          lastName: String(i),
          dateOfBirth: '1990-01-01',
          gender: 'OTHER',
          phone: `+91 92000${String(i).padStart(5, '0')}`,
        })
        .expect(201);

      const appointmentRes = await request(server)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: patientRes.body.data.id,
          doctorProfileId: doctorId,
          scheduledAt: SLOTS[i],
        })
        .expect(201);

      const entryRes = await request(server)
        .post('/api/v1/queue-entries')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ appointmentId: appointmentRes.body.data.id })
        .expect(201);
      queueId = entryRes.body.data.queueId;
    }

    const callNextAttempts = Array.from({ length: WAITING_PATIENTS }, () =>
      request(server)
        .post(`/api/v1/queues/${queueId}/call-next`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    const results = await Promise.all(callNextAttempts);

    expect(results.every((r) => r.status === 200)).toBe(true);
    const claimedEntryIds = results.map((r) => r.body.data.id);
    expect(new Set(claimedEntryIds).size).toBe(WAITING_PATIENTS);
    expect(results.every((r) => r.body.data.status === 'CALLED')).toBe(true);

    // Nobody left waiting — the next call-next must get a controlled response, not a crash.
    const exhausted = await request(server)
      .post(`/api/v1/queues/${queueId}/call-next`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(exhausted.body.error.code).toBe('NO_WAITING_PATIENTS');
  });
});
