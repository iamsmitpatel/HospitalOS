import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Mandatory IDOR / tenant-isolation / privacy / security matrix for the
 * Phase 3 operational modules (master doc §65-68): Department, Doctor,
 * Patient, Appointment, Queue. Builds a full operational graph (department,
 * doctor + schedule, patient, appointment, queue entry) independently in
 * Hospital A and Hospital B, then asserts cross-tenant access is denied
 * everywhere, mass assignment can't bypass the appointment state machine,
 * and a PATIENT-role account (via Phase 5 Connect self-registration — see
 * connect-idor.e2e-spec.ts for Connect's OWN patient-vs-patient IDOR matrix)
 * is still denied every STAFF/operational endpoint outright.
 */
describe('Operations tenant isolation & security (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';

  // Hospital A entities.
  let adminAToken: string;
  let deptAId: string;
  let doctorAId: string; // doctorProfile id
  let patientAId: string;
  let appointmentAId: string;
  let queueAId: string;
  let queueEntryAId: string;
  let patientRoleToken: string;

  // Hospital B entities.
  let adminBToken: string;
  let deptBId: string;
  let doctorBId: string;
  let patientBId: string;
  let appointmentBId: string;
  let queueBId: string;
  let queueEntryBId: string;

  const FUTURE_MONDAY_SLOT = '2027-10-11T03:30:00.000Z'; // 09:00 IST, a Monday

  async function setUpHospital(label: 'A' | 'B') {
    const adminEmail = `admin-${label.toLowerCase()}@hospitalos.dev`;
    const superAdminToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'root@hospitalos.dev', password })
        .expect(200)
    ).body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: `Hospital ${label}`,
        slug: `hospital-${label.toLowerCase()}`,
        code: `HOS${label}`,
      })
      .expect(201);
    const hospitalId = hospitalRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: adminEmail,
        password,
        firstName: 'Admin',
        lastName: label,
        role: 'HOSPITAL_ADMIN',
        hospitalId,
      })
      .expect(201);
    const adminToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password })
        .expect(200)
    ).body.data.accessToken;

    const deptRes = await request(server)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Cardiology ${label}`, code: `CARD${label}` })
      .expect(201);
    const deptId = deptRes.body.data.id;

    const doctorEmail = `doctor-${label.toLowerCase()}@hospitalos.dev`;
    const doctorUserRes = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: doctorEmail, password, firstName: 'Doc', lastName: label, role: 'DOCTOR' })
      .expect(201);

    const doctorRes = await request(server)
      .post('/api/v1/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: doctorUserRes.body.data.id,
        departmentId: deptId,
        specialization: 'Cardiology',
      })
      .expect(201);
    const doctorId = doctorRes.body.data.id;

    await request(server)
      .post(`/api/v1/doctors/${doctorId}/schedules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 15 })
      .expect(201);

    const patientRes = await request(server)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Patient',
        lastName: label,
        dateOfBirth: '1990-01-01',
        gender: 'FEMALE',
        phone: `+91 9000000${label === 'A' ? '001' : '002'}`,
      })
      .expect(201);
    const patientId = patientRes.body.data.id;

    const appointmentRes = await request(server)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ patientId, doctorProfileId: doctorId, scheduledAt: FUTURE_MONDAY_SLOT })
      .expect(201);
    const appointmentId = appointmentRes.body.data.id;

    const queueEntryRes = await request(server)
      .post('/api/v1/queue-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ appointmentId })
      .expect(201);
    const queueId = queueEntryRes.body.data.queueId;
    const queueEntryId = queueEntryRes.body.data.id;

    return { adminToken, deptId, doctorId, patientId, appointmentId, queueId, queueEntryId };
  }

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);

    await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);

    const a = await setUpHospital('A');
    adminAToken = a.adminToken;
    deptAId = a.deptId;
    doctorAId = a.doctorId;
    patientAId = a.patientId;
    appointmentAId = a.appointmentId;
    queueAId = a.queueId;
    queueEntryAId = a.queueEntryId;

    const b = await setUpHospital('B');
    adminBToken = b.adminToken;
    deptBId = b.deptId;
    doctorBId = b.doctorId;
    patientBId = b.patientId;
    appointmentBId = b.appointmentId;
    queueBId = b.queueId;
    queueEntryBId = b.queueEntryId;

    // A PATIENT-role account for the "Role.PATIENT is denied everything"
    // checks. Phase 5 made staff-created PATIENT users impossible (see
    // PATIENT_SELF_REGISTRATION_ONLY in users.service.ts) — Connect
    // self-registration is now the only way to get one.
    patientRoleToken = (
      await request(server)
        .post('/api/v1/auth/register-patient')
        .send({
          email: 'patient-role@hospitalos.dev',
          password,
          firstName: 'P',
          lastName: 'Role',
          phone: '+91 90000 00000',
          dateOfBirth: '1990-01-01',
          gender: 'FEMALE',
        })
        .expect(201)
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('IDOR matrix: Hospital A cannot reach Hospital B resources (§65)', () => {
    it('Department', async () => {
      const res = await request(server)
        .get(`/api/v1/departments/${deptBId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('DEPARTMENT_NOT_FOUND');
    });

    it('Doctor', async () => {
      const res = await request(server)
        .get(`/api/v1/doctors/${doctorBId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('DOCTOR_NOT_FOUND');
    });

    it('Patient (§66 — hospital A cannot retrieve a hospital B patient)', async () => {
      const res = await request(server)
        .get(`/api/v1/patients/${patientBId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('PATIENT_NOT_FOUND');
    });

    it('Appointment: read', async () => {
      const res = await request(server)
        .get(`/api/v1/appointments/${appointmentBId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
    });

    it("Appointment: cannot cancel another hospital's appointment (§67)", async () => {
      const res = await request(server)
        .post(`/api/v1/appointments/${appointmentBId}/cancel`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({})
        .expect(404);
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
    });

    it('Queue: read', async () => {
      const res = await request(server)
        .get(`/api/v1/queues/${queueBId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('QUEUE_NOT_FOUND');
    });

    it("Queue: cannot call-next on another hospital's queue (§68)", async () => {
      const res = await request(server)
        .post(`/api/v1/queues/${queueBId}/call-next`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('QUEUE_NOT_FOUND');
    });

    it("Queue entry: cannot skip another hospital's queue entry", async () => {
      const res = await request(server)
        .post(`/api/v1/queue-entries/${queueEntryBId}/skip`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('QUEUE_ENTRY_NOT_FOUND');
    });

    it('is symmetric: Hospital B cannot reach Hospital A either (department + doctor)', async () => {
      const deptRes = await request(server)
        .get(`/api/v1/departments/${deptAId}`)
        .set('Authorization', `Bearer ${adminBToken}`)
        .expect(404);
      expect(deptRes.body.error.code).toBe('DEPARTMENT_NOT_FOUND');

      const doctorRes = await request(server)
        .get(`/api/v1/doctors/${doctorAId}`)
        .set('Authorization', `Bearer ${adminBToken}`)
        .expect(404);
      expect(doctorRes.body.error.code).toBe('DOCTOR_NOT_FOUND');
    });
  });

  describe('mass assignment / state-machine bypass protection (§26/§67)', () => {
    it('cannot change appointment status through the PATCH body — the field does not exist on the DTO', async () => {
      const res = await request(server)
        .patch(`/api/v1/appointments/${appointmentAId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ reason: 'Follow-up', status: 'COMPLETED' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('cannot plant a different hospitalId on a department via the request body', async () => {
      const res = await request(server)
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ name: 'Neurology', code: 'NEURO', hospitalId: 'some-other-hospital-id' })
        .expect(201);
      // HOSPITAL_ADMIN's hospitalId is always server-derived, the body value is ignored.
      expect(res.body.data.hospitalId).not.toBe('some-other-hospital-id');
    });
  });

  describe('Role.PATIENT is denied every STAFF/operational endpoint (Connect self-service lives on separate /patient/* routes, §3/§55)', () => {
    it('cannot list patients', async () => {
      await request(server)
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${patientRoleToken}`)
        .expect(403);
    });

    it('cannot create an appointment', async () => {
      await request(server)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${patientRoleToken}`)
        .send({
          patientId: patientAId,
          doctorProfileId: doctorAId,
          scheduledAt: FUTURE_MONDAY_SLOT,
        })
        .expect(403);
    });

    it('cannot check in / join a queue', async () => {
      await request(server)
        .post('/api/v1/queue-entries')
        .set('Authorization', `Bearer ${patientRoleToken}`)
        .send({ appointmentId: appointmentAId })
        .expect(403);
    });

    it('cannot call next in a queue (§68 — a patient can never operate the queue)', async () => {
      await request(server)
        .post(`/api/v1/queues/${queueAId}/call-next`)
        .set('Authorization', `Bearer ${patientRoleToken}`)
        .expect(403);
    });

    it('cannot skip a queue entry', async () => {
      await request(server)
        .post(`/api/v1/queue-entries/${queueEntryAId}/skip`)
        .set('Authorization', `Bearer ${patientRoleToken}`)
        .expect(403);
    });
  });
});
