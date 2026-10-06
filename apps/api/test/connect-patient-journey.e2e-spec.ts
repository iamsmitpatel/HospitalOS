import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Phase 5 master doc "final E2E testing" Scenario B: the patient journey —
 * discover a hospital with no account at all, register, book, get checked
 * in and seen by staff, and read back the resulting clinical record
 * through her own Connect session. One continuous story, asserting state
 * after every step, same style as hospital-workflow.e2e-spec.ts (Scenario
 * A) and clinical-workflow.e2e-spec.ts (Scenarios C/D/E/F) — this is the
 * one scenario those didn't already cover, since neither predates
 * HospitalOS Connect. Scenario G (security) is covered by
 * security.e2e-spec.ts/rbac.e2e-spec.ts/connect-idor.e2e-spec.ts. Like
 * every other e2e file in this repo, written and type-checked but not
 * executed here — see /TESTING.md.
 */
describe('HospitalOS Connect — full patient journey (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const staffPassword = 'TestPass123';
  const SLOT = '2027-10-11T03:30:00.000Z'; // 09:00 IST, a Monday

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('discover -> register -> book -> check in -> call -> consult -> finalize -> read own record', async () => {
    // 1. Staff sets up a hospital, opts it into the public directory, and
    // configures one doctor with a Monday-morning schedule.
    const superAdminToken = (
      await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'root@hospitalos.dev',
          password: staffPassword,
          firstName: 'Root',
          lastName: 'Admin',
        })
        .expect(201)
    ).body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Journey Hospital', slug: 'journey-hospital', code: 'JRNY' })
      .expect(201);
    const hospitalId = hospitalRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin@journey.dev',
        password: staffPassword,
        firstName: 'Priya',
        lastName: 'Admin',
        role: 'HOSPITAL_ADMIN',
        hospitalId,
      })
      .expect(201);
    const adminToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@journey.dev', password: staffPassword })
        .expect(200)
    ).body.data.accessToken;

    await request(server)
      .patch(`/api/v1/hospitals/${hospitalId}/public-profile`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isPublic: true, city: 'Mumbai' })
      .expect(200);

    const deptRes = await request(server)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General Medicine', code: 'GEN' })
      .expect(201);
    const departmentId = deptRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'dr.rao@journey.dev',
        password: staffPassword,
        firstName: 'Anil',
        lastName: 'Rao',
        role: 'DOCTOR',
      })
      .expect(201);
    const doctorToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'dr.rao@journey.dev', password: staffPassword })
        .expect(200)
    ).body.data.accessToken;
    const doctorUserId = (
      await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200)
    ).body.data.id;

    const doctorRes = await request(server)
      .post('/api/v1/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: doctorUserId,
        departmentId,
        specialization: 'General Medicine',
        registrationNumber: 'MCI-JRNY-1',
      })
      .expect(201);
    const doctorId = doctorRes.body.data.id;

    await request(server)
      .post(`/api/v1/doctors/${doctorId}/schedules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 15 })
      .expect(201);

    // 2. A prospective patient, with no account yet, discovers the hospital
    // and doctor entirely anonymously.
    const discoveredHospitals = await request(server).get('/api/v1/discover/hospitals').expect(200);
    expect(discoveredHospitals.body.data.items.map((h: { id: string }) => h.id)).toContain(
      hospitalId,
    );

    const discoveredDoctors = await request(server)
      .get(`/api/v1/discover/hospitals/${hospitalId}/doctors`)
      .expect(200);
    expect(discoveredDoctors.body.data.map((d: { id: string }) => d.id)).toContain(doctorId);

    const discoveredSlots = await request(server)
      .get(`/api/v1/discover/doctors/${doctorId}/available-slots`)
      .query({ date: '2027-10-11' })
      .expect(200);
    expect(discoveredSlots.body.data).toContain(SLOT);

    // 3. She registers for HospitalOS Connect.
    const registerRes = await request(server)
      .post('/api/v1/auth/register-patient')
      .send({
        email: 'kavya@example.com',
        password: 'ConnectPass123',
        firstName: 'Kavya',
        lastName: 'Nair',
        phone: '+91 98111 22333',
        dateOfBirth: '1988-03-20',
        gender: 'FEMALE',
      })
      .expect(201);
    const patientToken = registerRes.body.data.accessToken;
    expect(registerRes.body.data.user.role).toBe('PATIENT');

    // 4. She books the discovered slot through Connect — auto-creating her
    // hospital-side Patient/MRN record in the same call.
    const bookingRes = await request(server)
      .post('/api/v1/patient/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ doctorProfileId: doctorId, scheduledAt: SLOT, reason: 'Annual checkup' })
      .expect(201);
    expect(bookingRes.body.data.status).toBe('SCHEDULED');
    const appointmentId = bookingRes.body.data.id;
    const connectPatientId = bookingRes.body.data.patientId;

    await request(server)
      .get(`/api/v1/patient/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    // 5. Staff checks her in — she can now see her own queue position.
    const checkInRes = await request(server)
      .post('/api/v1/queue-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ appointmentId })
      .expect(201);
    expect(checkInRes.body.data.status).toBe('WAITING');
    const queueId = checkInRes.body.data.queueId;
    const queueEntryId = checkInRes.body.data.id;

    const queueStatusWaiting = await request(server)
      .get(`/api/v1/patient/appointments/${appointmentId}/queue-status`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(queueStatusWaiting.body.data.status).toBe('WAITING');
    expect(queueStatusWaiting.body.data.position).toBe(1);

    // 6. Staff calls her next — her own status flips to CALLED.
    await request(server)
      .post(`/api/v1/queues/${queueId}/call-next`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const queueStatusCalled = await request(server)
      .get(`/api/v1/patient/appointments/${appointmentId}/queue-status`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(queueStatusCalled.body.data.status).toBe('CALLED');
    expect(queueStatusCalled.body.data.position).toBeNull();

    // 7. Consultation: start, document, finalize a diagnosis + prescription.
    await request(server)
      .post(`/api/v1/queue-entries/${queueEntryId}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const encounterRes = await request(server)
      .post('/api/v1/encounters')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ appointmentId })
      .expect(201);
    const encounterId = encounterRes.body.data.id;

    const diagnosisRes = await request(server)
      .post(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ description: 'Seasonal allergy', type: 'primary' })
      .expect(201);
    await request(server)
      .post(`/api/v1/diagnoses/${diagnosisRes.body.data.id}/finalize`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);

    await request(server)
      .post(`/api/v1/encounters/${encounterId}/notes`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ chiefComplaint: 'Sneezing, itchy eyes', assessment: 'Seasonal allergic rhinitis' })
      .expect(201);

    await request(server)
      .post(`/api/v1/queue-entries/${queueEntryId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const finalAppointmentRes = await request(server)
      .get(`/api/v1/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(finalAppointmentRes.body.data.status).toBe('COMPLETED');

    // 8. She reads her own finalized medical record back through Connect —
    // the encounter, the clinical note, and the FINALIZED diagnosis all
    // visible; nothing from any other patient, nothing still in DRAFT.
    const encountersRes = await request(server)
      .get(`/api/v1/patient/records/${connectPatientId}/encounters`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(encountersRes.body.data.map((e: { id: string }) => e.id)).toContain(encounterId);

    const encounterDetailRes = await request(server)
      .get(`/api/v1/patient/records/${connectPatientId}/encounters/${encounterId}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(encounterDetailRes.body.data.diagnoses).toHaveLength(1);
    expect(encounterDetailRes.body.data.diagnoses[0]).toMatchObject({
      description: 'Seasonal allergy',
      status: 'FINALIZED',
    });
    expect(encounterDetailRes.body.data.clinicalNotes[0]).toMatchObject({
      chiefComplaint: 'Sneezing, itchy eyes',
    });
  });
});
