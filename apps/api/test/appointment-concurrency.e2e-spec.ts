import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Master doc §85: 10 simultaneous booking attempts for the same doctor and
 * the same slot must yield exactly 1 success and 9 controlled conflicts,
 * never a double-booking. Proves the partial unique index
 * (appointments_doctor_active_slot_unique, see /DATABASE.md) is the real
 * backstop under a genuine race — the availability pre-check in
 * appointments.service.ts is necessarily racy on its own (read-then-write).
 */
describe('Appointment booking concurrency (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';
  const CONCURRENT_BOOKINGS = 10;
  const SLOT = '2027-10-11T03:30:00.000Z'; // 09:00 IST, a Monday

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows exactly one of 10 simultaneous bookings for the same doctor+slot to succeed', async () => {
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    const superAdminToken = registerRes.body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Race Hospital', slug: 'race-hospital', code: 'RACE' })
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

    // 10 distinct patients, all racing for the exact same doctor+slot.
    const patientIds: string[] = [];
    for (let i = 0; i < CONCURRENT_BOOKINGS; i += 1) {
      const res = await request(server)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Patient',
          lastName: String(i),
          dateOfBirth: '1990-01-01',
          gender: 'OTHER',
          phone: `+91 91000${String(i).padStart(5, '0')}`,
        })
        .expect(201);
      patientIds.push(res.body.data.id);
    }

    const attempts = patientIds.map((patientId) =>
      request(server)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ patientId, doctorProfileId: doctorId, scheduledAt: SLOT }),
    );

    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(CONCURRENT_BOOKINGS - 1);

    const listRes = await request(server)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ doctorId, pageSize: 100 })
      .expect(200);
    const bookedAtSlot = listRes.body.data.items.filter(
      (a: { scheduledAt: string; status: string }) =>
        a.scheduledAt === SLOT && a.status !== 'CANCELLED',
    );
    expect(bookedAtSlot).toHaveLength(1);
  });
});
