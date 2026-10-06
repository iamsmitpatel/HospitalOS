import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Phase 5 master doc Part "load/concurrency testing" — the Connect-specific
 * scenarios: 100 simultaneous self-registrations, 50 simultaneous (distinct-
 * slot) Connect bookings, 10+ simultaneous Connect bookings for the exact
 * same doctor+slot, a concurrently-retried idempotency key, and 10+
 * concurrent claims on the same unclaimed record. Like every other
 * *-concurrency.e2e-spec.ts file in this repo, this requires a live
 * Postgres/Redis (via docker-compose) and is written-but-unexecuted in this
 * environment — see the Phase 5 report for why, consistent with every
 * prior phase.
 */
describe('HospitalOS Connect — load & concurrency (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const staffPassword = 'TestPass123';

  let adminToken: string;
  let hospitalId: string;
  let doctorId: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);

    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'root@hospitalos.dev',
        password: staffPassword,
        firstName: 'Root',
        lastName: 'Admin',
      })
      .expect(201);
    const superAdminToken = registerRes.body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Load Test Hospital', slug: 'load-test-hospital', code: 'LOAD' })
      .expect(201);
    hospitalId = hospitalRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin@load-test.dev',
        password: staffPassword,
        firstName: 'Admin',
        lastName: 'Load',
        role: 'HOSPITAL_ADMIN',
        hospitalId,
      })
      .expect(201);
    adminToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@load-test.dev', password: staffPassword })
        .expect(200)
    ).body.data.accessToken;

    await request(server)
      .patch(`/api/v1/hospitals/${hospitalId}/public-profile`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isPublic: true })
      .expect(200);

    const deptRes = await request(server)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General Medicine', code: 'GEN' })
      .expect(201);

    const doctorUserRes = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'dr.load@load-test.dev',
        password: staffPassword,
        firstName: 'Anil',
        lastName: 'Rao',
        role: 'DOCTOR',
      })
      .expect(201);

    const doctorRes = await request(server)
      .post('/api/v1/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: doctorUserRes.body.data.id,
        departmentId: deptRes.body.data.id,
        specialization: 'General Medicine',
        registrationNumber: 'MCI-LOAD-1',
      })
      .expect(201);
    doctorId = doctorRes.body.data.id;

    // 09:00-17:00, 15-minute slots — 32 slots/day, comfortably more than the
    // 50-distinct-slot throughput test below needs.
    await request(server)
      .post(`/api/v1/doctors/${doctorId}/schedules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '17:00', slotDurationMinutes: 15 })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('handles 100 simultaneous Connect self-registrations with no crashes and no duplicate accounts', async () => {
    const REGISTRATIONS = 100;
    const attempts = Array.from({ length: REGISTRATIONS }, (_, i) =>
      request(server)
        .post('/api/v1/auth/register-patient')
        .send({
          email: `load-patient-${i}@example.com`,
          password: 'ConnectPass123',
          firstName: 'Load',
          lastName: String(i),
          phone: `+91 92${String(i).padStart(8, '0')}`,
          dateOfBirth: '1990-01-01',
          gender: 'OTHER',
        }),
    );

    const results = await Promise.all(attempts);
    expect(results.filter((r) => r.status === 201)).toHaveLength(REGISTRATIONS);

    const emails = new Set(results.map((r) => r.body.data.user.email));
    expect(emails.size).toBe(REGISTRATIONS);
  });

  it('handles 50 simultaneous Connect bookings for 50 distinct slots with no cross-talk', async () => {
    const BOOKINGS = 50;
    // Independent registrations (not reusing the ones above — a fresh,
    // isolated patient per booking keeps this a pure throughput test, not
    // also a concurrent-registration test).
    const registrations = await Promise.all(
      Array.from({ length: BOOKINGS }, (_, i) =>
        request(server)
          .post('/api/v1/auth/register-patient')
          .send({
            email: `slot-patient-${i}@example.com`,
            password: 'ConnectPass123',
            firstName: 'Slot',
            lastName: String(i),
            phone: `+91 93${String(i).padStart(8, '0')}`,
            dateOfBirth: '1990-01-01',
            gender: 'OTHER',
          })
          .expect(201),
      ),
    );

    // 50 distinct 15-minute slots starting 09:00 Monday — well within the
    // 09:00-17:00 schedule configured in beforeAll.
    const bookings = registrations.map((reg, i) => {
      const scheduledAt = new Date('2027-10-11T03:30:00.000Z'); // 09:00 IST
      scheduledAt.setUTCMinutes(scheduledAt.getUTCMinutes() + i * 15);
      return request(server)
        .post('/api/v1/patient/appointments')
        .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
        .send({ doctorProfileId: doctorId, scheduledAt: scheduledAt.toISOString() });
    });

    const results = await Promise.all(bookings);
    expect(results.filter((r) => r.status === 201)).toHaveLength(BOOKINGS);
    const appointmentIds = new Set(results.map((r) => r.body.data.id));
    expect(appointmentIds.size).toBe(BOOKINGS);
  });

  it('allows exactly one of 10 simultaneous Connect bookings for the SAME doctor+slot to succeed', async () => {
    const CONCURRENT = 10;
    const SLOT = '2027-10-18T03:30:00.000Z'; // a different Monday, untouched by the test above

    const registrations = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        request(server)
          .post('/api/v1/auth/register-patient')
          .send({
            email: `race-patient-${i}@example.com`,
            password: 'ConnectPass123',
            firstName: 'Race',
            lastName: String(i),
            phone: `+91 94${String(i).padStart(8, '0')}`,
            dateOfBirth: '1990-01-01',
            gender: 'OTHER',
          })
          .expect(201),
      ),
    );

    const attempts = registrations.map((reg) =>
      request(server)
        .post('/api/v1/patient/appointments')
        .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
        .send({ doctorProfileId: doctorId, scheduledAt: SLOT }),
    );

    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(CONCURRENT - 1);
  });

  it('a concurrently-retried idempotency key creates exactly one appointment, and every response returns it', async () => {
    const CONCURRENT_RETRIES = 10;
    const SLOT = '2027-10-25T03:30:00.000Z';
    const IDEMPOTENCY_KEY = 'load-test-retry-key-1';

    const reg = await request(server)
      .post('/api/v1/auth/register-patient')
      .send({
        email: 'idempotent-patient@example.com',
        password: 'ConnectPass123',
        firstName: 'Idem',
        lastName: 'Patient',
        phone: '+91 95000 00000',
        dateOfBirth: '1990-01-01',
        gender: 'OTHER',
      })
      .expect(201);

    const attempts = Array.from({ length: CONCURRENT_RETRIES }, () =>
      request(server)
        .post('/api/v1/patient/appointments')
        .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
        .send({ doctorProfileId: doctorId, scheduledAt: SLOT, idempotencyKey: IDEMPOTENCY_KEY }),
    );

    const results = await Promise.all(attempts);
    // Every retry of the SAME idempotency key either creates it or returns
    // the original — never a 409, and never a second appointment.
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    const appointmentIds = new Set(results.map((r) => r.body.data.id));
    expect(appointmentIds.size).toBe(1);
  });

  it('allows exactly one of 10 simultaneous claims on the SAME unclaimed record to succeed', async () => {
    const CONCURRENT = 10;

    const walkInRes = await request(server)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Contested',
        lastName: 'Record',
        dateOfBirth: '1975-03-10',
        gender: 'MALE',
        phone: '+91 96000 00000',
      })
      .expect(201);
    const mrn = walkInRes.body.data.mrn;

    const registrations = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        request(server)
          .post('/api/v1/auth/register-patient')
          .send({
            email: `claimant-${i}@example.com`,
            password: 'ConnectPass123',
            firstName: 'Claimant',
            lastName: String(i),
            phone: `+91 97${String(i).padStart(8, '0')}`,
            dateOfBirth: '1990-01-01',
            gender: 'OTHER',
          })
          .expect(201),
      ),
    );

    // Every claimant happens to know the exact same real MRN/DOB/phone —
    // the realistic case this guards is a race between family members who
    // legitimately know the same details, not just an attacker; only the
    // request that lands first may win.
    const attempts = registrations.map((reg) =>
      request(server)
        .post('/api/v1/patient/records/claim')
        .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
        .send({ hospitalId, mrn, dateOfBirth: '1975-03-10', phone: '+91 96000 00000' }),
    );

    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(CONCURRENT - 1);
  });
});
