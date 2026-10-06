import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * The Phase 4 analogue of hospital-workflow.e2e-spec.ts: the complete
 * clinical -> laboratory -> pharmacy -> billing -> payment -> refund
 * workflow in one continuous run, picking up exactly where Phase 3's queue
 * flow leaves off (appointment IN_CONSULTATION) and asserting the resulting
 * state at every step so a regression anywhere in the chain fails at the
 * step it broke, not just at the end.
 */
describe('Complete clinical/lab/pharmacy/billing workflow (e2e)', () => {
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

  it('runs the full encounter -> vitals -> notes -> diagnosis -> prescription -> lab -> dispense -> invoice -> payment -> refund flow', async () => {
    // --- 1. Platform bootstrap: hospital, admin, department, doctor, schedule, patient, appointment, queue up to IN_CONSULTATION.
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    const superAdminToken = registerRes.body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Workflow Hospital', slug: 'workflow-hospital', code: 'WFH' })
      .expect(201);
    const hospitalId = hospitalRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin@wfh.dev',
        password,
        firstName: 'Admin',
        lastName: 'WFH',
        role: 'HOSPITAL_ADMIN',
        hospitalId,
      })
      .expect(201);
    const adminToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@wfh.dev', password })
        .expect(200)
    ).body.data.accessToken;

    const deptRes = await request(server)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General Medicine', code: 'GENMED' })
      .expect(201);
    const departmentId = deptRes.body.data.id;

    const doctorUserRes = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'doctor@wfh.dev',
        password,
        firstName: 'Dr',
        lastName: 'House',
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
      })
      .expect(201);
    const doctorId = doctorRes.body.data.id;
    const doctorToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'doctor@wfh.dev', password })
        .expect(200)
    ).body.data.accessToken;

    await request(server)
      .post(`/api/v1/doctors/${doctorId}/schedules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '12:00', slotDurationMinutes: 15 })
      .expect(201);

    async function createStaff(email: string, role: string) {
      await request(server)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email, password, firstName: role, lastName: 'Staff', role })
        .expect(201);
      return (
        await request(server).post('/api/v1/auth/login').send({ email, password }).expect(200)
      ).body.data.accessToken;
    }

    const nurseToken = await createStaff('nurse@wfh.dev', 'NURSE');
    const pharmacistToken = await createStaff('pharmacist@wfh.dev', 'PHARMACIST');
    const labTechAToken = await createStaff('labtech-a@wfh.dev', 'LAB_TECHNICIAN');
    const labTechBToken = await createStaff('labtech-b@wfh.dev', 'LAB_TECHNICIAN');
    const accountantToken = await createStaff('accountant@wfh.dev', 'ACCOUNTANT');

    // --- 2. Catalogs: medicine + stock, lab test, billable service + price.
    const medicineRes = await request(server)
      .post('/api/v1/medicines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Paracetamol', strength: '500mg', form: 'tablet' })
      .expect(201);
    const medicineId = medicineRes.body.data.id;

    await request(server)
      .post(`/api/v1/medicines/${medicineId}/stock-batches`)
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ batchNumber: 'B-WFH-001', quantityReceived: 100, expiryDate: '2030-01-01' })
      .expect(201);

    const labTestRes = await request(server)
      .post('/api/v1/lab-tests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Complete Blood Count', code: 'CBC', sampleType: 'Venous blood' })
      .expect(201);
    const labTestId = labTestRes.body.data.id;

    const serviceRes = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ name: 'General Consultation', code: 'CONSULT-GEN', category: 'CONSULTATION' })
      .expect(201);
    const serviceId = serviceRes.body.data.id;
    await request(server)
      .post(`/api/v1/services/${serviceId}/prices`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ amount: 500 })
      .expect(201);

    // --- 3. Patient, appointment, check-in, call, start consultation (Phase 3 flow).
    const patientRes = await request(server)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Asha',
        lastName: 'Verma',
        dateOfBirth: '1992-05-10',
        gender: 'FEMALE',
        phone: '+91 90000 00001',
      })
      .expect(201);
    const patientId = patientRes.body.data.id;

    const appointmentRes = await request(server)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ patientId, doctorProfileId: doctorId, scheduledAt: SLOT, reason: 'Fever' })
      .expect(201);
    const appointmentId = appointmentRes.body.data.id;

    const checkInRes = await request(server)
      .post('/api/v1/queue-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ appointmentId })
      .expect(201);
    const queueId = checkInRes.body.data.queueId;
    const queueEntryId = checkInRes.body.data.id;

    await request(server)
      .post(`/api/v1/queues/${queueId}/call-next`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(server)
      .post(`/api/v1/queue-entries/${queueEntryId}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const appointmentInConsultationRes = await request(server)
      .get(`/api/v1/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(appointmentInConsultationRes.body.data.status).toBe('IN_CONSULTATION');

    // --- 4. Encounter: only the owning doctor, only once the appointment is IN_CONSULTATION.
    const forbiddenEncounterRes = await request(server)
      .post('/api/v1/encounters')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ appointmentId })
      .expect(403);
    expect(forbiddenEncounterRes.body.success).toBe(false);

    const encounterRes = await request(server)
      .post('/api/v1/encounters')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ appointmentId })
      .expect(201);
    expect(encounterRes.body.data.status).toBe('IN_PROGRESS');
    expect(encounterRes.body.data.patientId).toBe(patientId);
    const encounterId = encounterRes.body.data.id;

    // --- 5. Vitals (nurse), clinical note + diagnosis + prescription (doctor).
    await request(server)
      .post(`/api/v1/encounters/${encounterId}/vitals`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({
        heartRateBpm: 92,
        temperatureCelsius: 38.4,
        bloodPressureSystolic: 118,
        bloodPressureDiastolic: 76,
      })
      .expect(201);

    await request(server)
      .post(`/api/v1/encounters/${encounterId}/notes`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ chiefComplaint: 'Fever for 2 days', assessment: 'Likely viral fever' })
      .expect(201);

    const diagnosisRes = await request(server)
      .post(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ description: 'Viral fever', type: 'primary' })
      .expect(201);
    expect(diagnosisRes.body.data.status).toBe('DRAFT');
    const diagnosisId = diagnosisRes.body.data.id;

    const finalizedDiagnosisRes = await request(server)
      .post(`/api/v1/diagnoses/${diagnosisId}/finalize`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    expect(finalizedDiagnosisRes.body.data.status).toBe('FINALIZED');

    const prescriptionRes = await request(server)
      .post(`/api/v1/encounters/${encounterId}/prescriptions`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        items: [
          {
            medicineId,
            dosage: '500mg',
            frequency: 'Twice daily',
            duration: '5 days',
            quantity: 10,
          },
        ],
      })
      .expect(201);
    const prescriptionId = prescriptionRes.body.data.id;
    const prescriptionItemId = prescriptionRes.body.data.items[0].id;

    const finalizedPrescriptionRes = await request(server)
      .post(`/api/v1/prescriptions/${prescriptionId}/finalize`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    expect(finalizedPrescriptionRes.body.data.status).toBe('FINALIZED');

    // --- 6. Lab order -> specimen collection -> result entry -> maker-checker verification.
    const labOrderRes = await request(server)
      .post(`/api/v1/encounters/${encounterId}/lab-orders`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ items: [{ labTestId }] })
      .expect(201);
    expect(labOrderRes.body.data.status).toBe('ORDERED');
    const labOrderItemId = labOrderRes.body.data.items[0].id;

    await request(server)
      .post(`/api/v1/lab-order-items/${labOrderItemId}/collect`)
      .set('Authorization', `Bearer ${labTechAToken}`)
      .send({ specimenType: 'Venous blood' })
      .expect(201);

    const labResultRes = await request(server)
      .post(`/api/v1/lab-order-items/${labOrderItemId}/result`)
      .set('Authorization', `Bearer ${labTechAToken}`)
      .send({ value: '11.2', unit: 'g/dL' })
      .expect(201);
    expect(labResultRes.body.data.status).toBe('ENTERED');
    const labResultId = labResultRes.body.data.id;

    // The order rolls up to COMPLETED once its only item has a result.
    const labOrderAfterResultRes = await request(server)
      .get(`/api/v1/lab-orders/${labOrderRes.body.data.id}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    expect(labOrderAfterResultRes.body.data.status).toBe('COMPLETED');

    // Maker-checker: the enterer cannot verify their own result.
    const selfVerifyRes = await request(server)
      .post(`/api/v1/lab-results/${labResultId}/verify`)
      .set('Authorization', `Bearer ${labTechAToken}`)
      .expect(403);
    expect(selfVerifyRes.body.error.code).toBe('SELF_VERIFICATION_FORBIDDEN');

    const verifiedRes = await request(server)
      .post(`/api/v1/lab-results/${labResultId}/verify`)
      .set('Authorization', `Bearer ${labTechBToken}`)
      .expect(200);
    expect(verifiedRes.body.data.status).toBe('VERIFIED');

    // --- 7. Pharmacy: dispense against the finalized prescription, FEFO-decrementing stock.
    const dispenseRes = await request(server)
      .post('/api/v1/dispense-records')
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ prescriptionItemId, quantity: 10 })
      .expect(201);
    expect(dispenseRes.body.data).toHaveLength(1);
    expect(dispenseRes.body.data[0].quantity).toBe(10);

    const stockBatchesAfterDispenseRes = await request(server)
      .get(`/api/v1/medicines/${medicineId}/stock-batches`)
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .expect(200);
    expect(stockBatchesAfterDispenseRes.body.data[0].quantityRemaining).toBe(90);

    // --- 8. Close the encounter -> appointment syncs to COMPLETED.
    const completedEncounterRes = await request(server)
      .post(`/api/v1/encounters/${encounterId}/complete`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    expect(completedEncounterRes.body.data.status).toBe('COMPLETED');

    const appointmentAfterEncounterRes = await request(server)
      .get(`/api/v1/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(appointmentAfterEncounterRes.body.data.status).toBe('COMPLETED');

    // --- 9. Billing: invoice (catalog service + free-form lab fee) -> issue -> pay -> partial refund.
    const invoiceRes = await request(server)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({
        patientId,
        encounterId,
        items: [{ serviceId }, { description: 'Lab processing fee', unitPrice: 200, quantity: 1 }],
        taxRate: 0.1,
      })
      .expect(201);
    expect(invoiceRes.body.data.status).toBe('DRAFT');
    expect(invoiceRes.body.data.subtotal).toBe('700');
    expect(invoiceRes.body.data.taxAmount).toBe('70');
    expect(invoiceRes.body.data.total).toBe('770');
    const invoiceId = invoiceRes.body.data.id;

    const issuedInvoiceRes = await request(server)
      .post(`/api/v1/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(issuedInvoiceRes.body.data.status).toBe('ISSUED');

    const paymentRes = await request(server)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ invoiceId, amount: 770, method: 'CASH' })
      .expect(201);
    expect(paymentRes.body.data.amount).toBe('770');
    const paymentId = paymentRes.body.data.id;

    const paidInvoiceRes = await request(server)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(paidInvoiceRes.body.data.status).toBe('PAID');
    expect(paidInvoiceRes.body.data.amountPaid).toBe('770');

    const refundRes = await request(server)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ invoiceId, paymentId, amount: 70, reason: 'Goodwill adjustment' })
      .expect(201);
    expect(refundRes.body.data.amount).toBe('70');

    const finalInvoiceRes = await request(server)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);
    expect(finalInvoiceRes.body.data.status).toBe('PARTIALLY_PAID');
    expect(finalInvoiceRes.body.data.amountRefunded).toBe('70');
  });
});
