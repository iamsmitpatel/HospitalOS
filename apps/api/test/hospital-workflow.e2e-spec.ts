import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * The most important end-to-end test in Phase 3 (master doc §87): the
 * complete hospital operations workflow in one continuous run, exactly as
 * described — admin login, department, doctor, schedule, patient + MRN,
 * appointment, check-in, queue, call, consultation, completion. Every step
 * asserts the resulting state before moving to the next, so a regression
 * anywhere in the chain fails at the step it broke, not just at the end.
 */
describe('Complete hospital workflow (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';
  const SLOT = '2027-10-11T03:30:00.000Z'; // 09:00 IST, a Monday

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the full admin -> department -> doctor -> patient -> appointment -> queue -> consultation -> completion flow', async () => {
    // 1. Bootstrap platform SUPER_ADMIN, create the hospital and its admin, log in as admin.
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    const superAdminToken = registerRes.body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Sunrise Hospital', slug: 'sunrise-hospital', code: 'SUN' })
      .expect(201);
    const hospitalId = hospitalRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin@sunrise.dev',
        password,
        firstName: 'Priya',
        lastName: 'Admin',
        role: 'HOSPITAL_ADMIN',
        hospitalId,
      })
      .expect(201);
    const adminLoginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@sunrise.dev', password })
      .expect(200);
    const adminToken = adminLoginRes.body.data.accessToken;

    // 2. Create Department.
    const deptRes = await request(server)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cardiology', code: 'CARD', description: 'Heart and vascular care' })
      .expect(201);
    expect(deptRes.body.data.isActive).toBe(true);
    const departmentId = deptRes.body.data.id;

    // 3. Create Doctor (account via Users, then attach a professional profile).
    const doctorUserRes = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'dr.rao@sunrise.dev',
        password,
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
        specialization: 'Cardiology',
        registrationNumber: 'MCI-12345',
      })
      .expect(201);
    expect(doctorRes.body.data.displayName).toBe('Dr. Anil Rao');
    expect(doctorRes.body.data.status).toBe('ACTIVE');
    const doctorId = doctorRes.body.data.id;

    // 4. Configure Doctor Schedule.
    await request(server)
      .post(`/api/v1/doctors/${doctorId}/schedules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 15 })
      .expect(201);

    const slotsRes = await request(server)
      .get(`/api/v1/doctors/${doctorId}/available-slots`)
      .query({ date: '2027-10-11' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(slotsRes.body.data).toContain(SLOT);

    // 5. Create Patient — generates an MRN.
    const patientRes = await request(server)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Kavya',
        lastName: 'Nair',
        dateOfBirth: '1988-03-20',
        gender: 'FEMALE',
        phone: '+91 98111 22333',
        emergencyContactName: 'Ravi Nair',
        emergencyContactPhone: '+91 98111 99999',
      })
      .expect(201);
    expect(patientRes.body.data.mrn).toMatch(/^SUN-\d{6}$/);
    const patientId = patientRes.body.data.id;

    // 6. Create Appointment.
    const appointmentRes = await request(server)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        patientId,
        doctorProfileId: doctorId,
        scheduledAt: SLOT,
        reason: 'Annual checkup',
      })
      .expect(201);
    expect(appointmentRes.body.data.status).toBe('SCHEDULED');
    const appointmentId = appointmentRes.body.data.id;

    // 7. Check appointment (lookup by id).
    const appointmentCheckRes = await request(server)
      .get(`/api/v1/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(appointmentCheckRes.body.data.patientId).toBe(patientId);
    expect(appointmentCheckRes.body.data.doctorProfileId).toBe(doctorId);

    // That slot is no longer offered as available once booked.
    const slotsAfterBookingRes = await request(server)
      .get(`/api/v1/doctors/${doctorId}/available-slots`)
      .query({ date: '2027-10-11' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(slotsAfterBookingRes.body.data).not.toContain(SLOT);

    // 8. Check patient in -> creates the Queue Entry -> appointment moves to IN_QUEUE.
    const checkInRes = await request(server)
      .post('/api/v1/queue-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ appointmentId })
      .expect(201);
    expect(checkInRes.body.data.status).toBe('WAITING');
    expect(checkInRes.body.data.tokenNumber).toBe(1);
    const queueId = checkInRes.body.data.queueId;
    const queueEntryId = checkInRes.body.data.id;

    const appointmentAfterCheckInRes = await request(server)
      .get(`/api/v1/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(appointmentAfterCheckInRes.body.data.status).toBe('IN_QUEUE');

    // 9. Call the patient.
    const callRes = await request(server)
      .post(`/api/v1/queues/${queueId}/call-next`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(callRes.body.data.id).toBe(queueEntryId);
    expect(callRes.body.data.status).toBe('CALLED');
    expect(callRes.body.data.calledAt).not.toBeNull();

    // 10. Move to consultation state.
    const startRes = await request(server)
      .post(`/api/v1/queue-entries/${queueEntryId}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(startRes.body.data.status).toBe('IN_CONSULTATION');

    const appointmentInConsultationRes = await request(server)
      .get(`/api/v1/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(appointmentInConsultationRes.body.data.status).toBe('IN_CONSULTATION');

    // 11. Complete the queue entry -> appointment completes in the same step.
    const completeEntryRes = await request(server)
      .post(`/api/v1/queue-entries/${queueEntryId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(completeEntryRes.body.data.status).toBe('COMPLETED');
    expect(completeEntryRes.body.data.completedAt).not.toBeNull();

    // 12. Complete Appointment — verify it reflects COMPLETED without a separate call.
    const finalAppointmentRes = await request(server)
      .get(`/api/v1/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(finalAppointmentRes.body.data.status).toBe('COMPLETED');

    // Sanity: COMPLETED is terminal — cannot cancel after the fact (§32).
    const cancelAfterCompleteRes = await request(server)
      .post(`/api/v1/appointments/${appointmentId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(409);
    expect(cancelAfterCompleteRes.body.error.code).toBe('INVALID_APPOINTMENT_TRANSITION');
  });
});
