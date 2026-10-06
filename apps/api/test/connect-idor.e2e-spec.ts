import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * HospitalOS Connect introduced a brand-new attack surface in Phase 5: a
 * Connect patient has no hospitalId (unlike every actor tenant-isolation.
 * e2e-spec.ts already covers), so ownership of an appointment/patient
 * record/queue entry is resolved through the Patient.userId link instead
 * of a hospitalId match. This file is the IDOR-specific extension the
 * Phase 5 master doc Part 5 calls for: Connect Patient A must never be able
 * to read, cancel, or claim anything belonging to Connect Patient B,
 * exercised through the real HTTP surface end to end.
 */
describe('HospitalOS Connect — IDOR (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const staffPassword = 'TestPass123';
  const SLOT = '2027-10-11T03:30:00.000Z'; // 09:00 IST, a Monday

  let adminToken: string;
  let doctorId: string;
  let hospitalId: string;

  let patientATokens: { accessToken: string };
  let patientBTokens: { accessToken: string };
  let appointmentIdA: string;
  let connectPatientRecordIdA: string;

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
      .send({ name: 'Connect Test Hospital', slug: 'connect-test-hospital', code: 'CTH' })
      .expect(201);
    hospitalId = hospitalRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin@connect-test.dev',
        password: staffPassword,
        firstName: 'Priya',
        lastName: 'Admin',
        role: 'HOSPITAL_ADMIN',
        hospitalId,
      })
      .expect(201);
    const adminLoginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@connect-test.dev', password: staffPassword })
      .expect(200);
    adminToken = adminLoginRes.body.data.accessToken;

    // Hospital must opt in to the public directory — isPublic defaults to
    // false, so without this, Connect could never find it at all.
    await request(server)
      .patch(`/api/v1/hospitals/${hospitalId}/public-profile`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isPublic: true })
      .expect(200);

    const deptRes = await request(server)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General Medicine', code: 'GEN', description: 'General medicine' })
      .expect(201);
    const departmentId = deptRes.body.data.id;

    const doctorUserRes = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'dr.rao@connect-test.dev',
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
        departmentId,
        specialization: 'General Medicine',
        registrationNumber: 'MCI-99999',
      })
      .expect(201);
    doctorId = doctorRes.body.data.id;

    await request(server)
      .post(`/api/v1/doctors/${doctorId}/schedules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 15 })
      .expect(201);

    // Two independent Connect patient accounts — the actors for every IDOR
    // check below.
    const registerA = await request(server)
      .post('/api/v1/auth/register-patient')
      .send({
        email: 'patient-a@example.com',
        password: 'ConnectPass123',
        firstName: 'Asha',
        lastName: 'Patel',
        phone: '+91 90000 00001',
        dateOfBirth: '1995-01-01',
        gender: 'FEMALE',
      })
      .expect(201);
    patientATokens = { accessToken: registerA.body.data.accessToken };

    const registerB = await request(server)
      .post('/api/v1/auth/register-patient')
      .send({
        email: 'patient-b@example.com',
        password: 'ConnectPass123',
        firstName: 'Rohan',
        lastName: 'Shah',
        phone: '+91 90000 00002',
        dateOfBirth: '1992-02-02',
        gender: 'MALE',
      })
      .expect(201);
    patientBTokens = { accessToken: registerB.body.data.accessToken };
  });

  afterAll(async () => {
    await app.close();
  });

  it('discovery is public and surfaces the opted-in hospital/doctor with no auth at all', async () => {
    const hospitals = await request(server).get('/api/v1/discover/hospitals').expect(200);
    expect(hospitals.body.data.items.map((h: { id: string }) => h.id)).toContain(hospitalId);

    const doctors = await request(server)
      .get(`/api/v1/discover/hospitals/${hospitalId}/doctors`)
      .expect(200);
    expect(doctors.body.data.map((d: { id: string }) => d.id)).toContain(doctorId);
  });

  it('Patient A books an appointment through Connect (auto-creates her Patient record)', async () => {
    const res = await request(server)
      .post('/api/v1/patient/appointments')
      .set('Authorization', `Bearer ${patientATokens.accessToken}`)
      .send({ doctorProfileId: doctorId, scheduledAt: SLOT, reason: 'Checkup' })
      .expect(201);

    expect(res.body.data.status).toBe('SCHEDULED');
    appointmentIdA = res.body.data.id;
    connectPatientRecordIdA = res.body.data.patientId;
  });

  it('A -> A: Patient A can read her own appointment', async () => {
    await request(server)
      .get(`/api/v1/patient/appointments/${appointmentIdA}`)
      .set('Authorization', `Bearer ${patientATokens.accessToken}`)
      .expect(200);
  });

  it("B -> A: Patient B cannot read Patient A's appointment (404, not 403)", async () => {
    const res = await request(server)
      .get(`/api/v1/patient/appointments/${appointmentIdA}`)
      .set('Authorization', `Bearer ${patientBTokens.accessToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
  });

  it("B -> A: Patient B cannot cancel Patient A's appointment", async () => {
    const res = await request(server)
      .post(`/api/v1/patient/appointments/${appointmentIdA}/cancel`)
      .set('Authorization', `Bearer ${patientBTokens.accessToken}`)
      .send({ reason: 'not mine' })
      .expect(404);
    expect(res.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
  });

  it("Patient B's own appointment list never contains Patient A's appointment", async () => {
    const res = await request(server)
      .get('/api/v1/patient/appointments')
      .set('Authorization', `Bearer ${patientBTokens.accessToken}`)
      .expect(200);
    expect(res.body.data.map((a: { id: string }) => a.id)).not.toContain(appointmentIdA);
  });

  it("B -> A: Patient B cannot read Patient A's medical records (encounters/prescriptions/lab-orders/invoices)", async () => {
    for (const resource of ['encounters', 'prescriptions', 'lab-orders', 'invoices']) {
      const res = await request(server)
        .get(`/api/v1/patient/records/${connectPatientRecordIdA}/${resource}`)
        .set('Authorization', `Bearer ${patientBTokens.accessToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('PATIENT_NOT_FOUND');
    }
  });

  it('A -> A: Patient A can read her own (empty) medical record lists', async () => {
    const res = await request(server)
      .get(`/api/v1/patient/records/${connectPatientRecordIdA}/encounters`)
      .set('Authorization', `Bearer ${patientATokens.accessToken}`)
      .expect(200);
    expect(res.body.data).toEqual([]);
  });

  describe('claiming a pre-existing staff-created record', () => {
    let unclaimedMrn: string;

    beforeAll(async () => {
      const patientRes = await request(server)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Walk',
          lastName: 'In',
          dateOfBirth: '1980-06-15',
          gender: 'MALE',
          phone: '+91 90000 09999',
        })
        .expect(201);
      unclaimedMrn = patientRes.body.data.mrn;
    });

    it('rejects a claim with the wrong phone using the SAME generic error as "no such record"', async () => {
      const res = await request(server)
        .post('/api/v1/patient/records/claim')
        .set('Authorization', `Bearer ${patientBTokens.accessToken}`)
        .send({
          hospitalId,
          mrn: unclaimedMrn,
          dateOfBirth: '1980-06-15',
          phone: '+91 00000 00000',
        })
        .expect(400);
      expect(res.body.error.code).toBe('PATIENT_RECORD_CLAIM_FAILED');
    });

    it('links the record when every detail matches exactly', async () => {
      await request(server)
        .post('/api/v1/patient/records/claim')
        .set('Authorization', `Bearer ${patientBTokens.accessToken}`)
        .send({
          hospitalId,
          mrn: unclaimedMrn,
          dateOfBirth: '1980-06-15',
          phone: '+91 90000 09999',
        })
        .expect(200);
    });

    it('a second claim attempt on the now-already-claimed record fails with the SAME generic error', async () => {
      const res = await request(server)
        .post('/api/v1/patient/records/claim')
        .set('Authorization', `Bearer ${patientATokens.accessToken}`)
        .send({
          hospitalId,
          mrn: unclaimedMrn,
          dateOfBirth: '1980-06-15',
          phone: '+91 90000 09999',
        })
        .expect(400);
      expect(res.body.error.code).toBe('PATIENT_RECORD_CLAIM_FAILED');
    });
  });

  it('A -> A: Patient A cancels her own appointment successfully', async () => {
    const res = await request(server)
      .post(`/api/v1/patient/appointments/${appointmentIdA}/cancel`)
      .set('Authorization', `Bearer ${patientATokens.accessToken}`)
      .send({ reason: 'schedule conflict' })
      .expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });
});
