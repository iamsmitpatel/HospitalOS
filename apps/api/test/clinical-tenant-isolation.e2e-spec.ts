import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Extends operations-tenant-isolation.e2e-spec.ts's IDOR matrix (master doc
 * §65-68) to the Phase 4 clinical/laboratory/pharmacy/billing resources:
 * Encounter, Diagnosis, Prescription, LabOrder, LabResult, Medicine,
 * StockBatch, Service, Invoice, Payment. Builds one minimal clinical+
 * financial graph independently in Hospital A and Hospital B, then asserts
 * Hospital A can never read or act on Hospital B's rows.
 */
describe('Clinical/laboratory/pharmacy/billing tenant isolation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';
  const SLOT = '2027-10-11T03:30:00.000Z'; // 09:00 IST, a Monday

  // Only the ids actually targeted FROM Hospital B in a cross-tenant check
  // below are kept — the rest of Hospital A's graph exists only so Hospital
  // B has something real to probe against.
  let adminAToken: string;
  let doctorAToken: string;
  let encounterAId: string;
  let labOrderItemAId: string;
  let invoiceAId: string;

  let adminBToken: string;
  let doctorBToken: string;
  let labTechBToken: string;
  let encounterBId: string;
  let diagnosisBId: string;
  let prescriptionBId: string;
  let labOrderBId: string;
  let labResultBId: string;
  let medicineBId: string;
  let stockBatchBId: string;
  let serviceBId: string;
  let invoiceBId: string;
  let paymentBId: string;

  async function setUpHospital(label: 'A' | 'B') {
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
        name: `Clinical Hospital ${label}`,
        slug: `clinical-hospital-${label.toLowerCase()}`,
        code: `CLN${label}`,
      })
      .expect(201);
    const hospitalId = hospitalRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: `admin-${label.toLowerCase()}@clinical.dev`,
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
        .send({ email: `admin-${label.toLowerCase()}@clinical.dev`, password })
        .expect(200)
    ).body.data.accessToken;

    const deptRes = await request(server)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Medicine ${label}`, code: `MED${label}` })
      .expect(201);
    const departmentId = deptRes.body.data.id;

    const doctorUserRes = await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `doctor-${label.toLowerCase()}@clinical.dev`,
        password,
        firstName: 'Doc',
        lastName: label,
        role: 'DOCTOR',
      })
      .expect(201);
    const doctorRes = await request(server)
      .post('/api/v1/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: doctorUserRes.body.data.id, departmentId, specialization: 'General' })
      .expect(201);
    const doctorId = doctorRes.body.data.id;
    const doctorToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: `doctor-${label.toLowerCase()}@clinical.dev`, password })
        .expect(200)
    ).body.data.accessToken;

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
        gender: 'OTHER',
        phone: `+91 9100000${label === 'A' ? '001' : '002'}`,
      })
      .expect(201);
    const patientId = patientRes.body.data.id;

    const appointmentRes = await request(server)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ patientId, doctorProfileId: doctorId, scheduledAt: SLOT })
      .expect(201);
    const appointmentId = appointmentRes.body.data.id;

    const checkInRes = await request(server)
      .post('/api/v1/queue-entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ appointmentId })
      .expect(201);
    await request(server)
      .post(`/api/v1/queues/${checkInRes.body.data.queueId}/call-next`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(server)
      .post(`/api/v1/queue-entries/${checkInRes.body.data.id}/start`)
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
      .send({ description: `Diagnosis ${label}` })
      .expect(201);
    const diagnosisId = diagnosisRes.body.data.id;

    const medicineRes = await request(server)
      .post('/api/v1/medicines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Medicine ${label}` })
      .expect(201);
    const medicineId = medicineRes.body.data.id;

    const stockBatchRes = await request(server)
      .post(`/api/v1/medicines/${medicineId}/stock-batches`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batchNumber: `BATCH-${label}`, quantityReceived: 50, expiryDate: '2030-01-01' })
      .expect(201);
    const stockBatchId = stockBatchRes.body.data.id;

    const prescriptionRes = await request(server)
      .post(`/api/v1/encounters/${encounterId}/prescriptions`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        items: [{ medicineId, dosage: '1', frequency: '1', duration: '1', quantity: 1 }],
      })
      .expect(201);
    const prescriptionId = prescriptionRes.body.data.id;

    const labTestRes = await request(server)
      .post('/api/v1/lab-tests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Test ${label}`, code: `T${label}` })
      .expect(201);

    const labOrderRes = await request(server)
      .post(`/api/v1/encounters/${encounterId}/lab-orders`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ items: [{ labTestId: labTestRes.body.data.id }] })
      .expect(201);
    const labOrderId = labOrderRes.body.data.id;
    const labOrderItemId = labOrderRes.body.data.items[0].id;

    const labTechToken = await (async () => {
      await request(server)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: `labtech-${label.toLowerCase()}@clinical.dev`,
          password,
          firstName: 'Lab',
          lastName: label,
          role: 'LAB_TECHNICIAN',
        })
        .expect(201);
      return (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email: `labtech-${label.toLowerCase()}@clinical.dev`, password })
          .expect(200)
      ).body.data.accessToken;
    })();

    await request(server)
      .post(`/api/v1/lab-order-items/${labOrderItemId}/collect`)
      .set('Authorization', `Bearer ${labTechToken}`)
      .expect(201);
    const labResultRes = await request(server)
      .post(`/api/v1/lab-order-items/${labOrderItemId}/result`)
      .set('Authorization', `Bearer ${labTechToken}`)
      .send({ value: '1.0' })
      .expect(201);
    const labResultId = labResultRes.body.data.id;

    const serviceRes = await request(server)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Service ${label}`, code: `SVC${label}` })
      .expect(201);
    const serviceId = serviceRes.body.data.id;

    const invoiceRes = await request(server)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ patientId, items: [{ description: 'Fee', unitPrice: 100, quantity: 1 }] })
      .expect(201);
    const invoiceId = invoiceRes.body.data.id;
    await request(server)
      .post(`/api/v1/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const paymentRes = await request(server)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ invoiceId, amount: 100, method: 'CASH' })
      .expect(201);
    const paymentId = paymentRes.body.data.id;

    return {
      adminToken,
      doctorToken,
      labTechToken,
      encounterId,
      diagnosisId,
      prescriptionId,
      labOrderId,
      labOrderItemId,
      labResultId,
      medicineId,
      stockBatchId,
      serviceId,
      invoiceId,
      paymentId,
    };
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
    doctorAToken = a.doctorToken;
    encounterAId = a.encounterId;
    labOrderItemAId = a.labOrderItemId;
    invoiceAId = a.invoiceId;

    const b = await setUpHospital('B');
    adminBToken = b.adminToken;
    doctorBToken = b.doctorToken;
    labTechBToken = b.labTechToken;
    encounterBId = b.encounterId;
    diagnosisBId = b.diagnosisId;
    prescriptionBId = b.prescriptionId;
    labOrderBId = b.labOrderId;
    labResultBId = b.labResultId;
    medicineBId = b.medicineId;
    stockBatchBId = b.stockBatchId;
    serviceBId = b.serviceId;
    invoiceBId = b.invoiceId;
    paymentBId = b.paymentId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Hospital A cannot read Hospital B’s encounter', async () => {
    const res = await request(server)
      .get(`/api/v1/encounters/${encounterBId}`)
      .set('Authorization', `Bearer ${doctorAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('ENCOUNTER_NOT_FOUND');
  });

  it('Hospital A cannot complete Hospital B’s encounter', async () => {
    const res = await request(server)
      .post(`/api/v1/encounters/${encounterBId}/complete`)
      .set('Authorization', `Bearer ${doctorAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('ENCOUNTER_NOT_FOUND');
  });

  it('Hospital A cannot read Hospital B’s diagnosis', async () => {
    const res = await request(server)
      .get(`/api/v1/diagnoses/${diagnosisBId}`)
      .set('Authorization', `Bearer ${doctorAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('DIAGNOSIS_NOT_FOUND');
  });

  it('Hospital A cannot finalize Hospital B’s diagnosis', async () => {
    const res = await request(server)
      .post(`/api/v1/diagnoses/${diagnosisBId}/finalize`)
      .set('Authorization', `Bearer ${doctorAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('DIAGNOSIS_NOT_FOUND');
  });

  it('Hospital A cannot read Hospital B’s prescription', async () => {
    const res = await request(server)
      .get(`/api/v1/prescriptions/${prescriptionBId}`)
      .set('Authorization', `Bearer ${doctorAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('PRESCRIPTION_NOT_FOUND');
  });

  it('Hospital A cannot read Hospital B’s lab order', async () => {
    const res = await request(server)
      .get(`/api/v1/lab-orders/${labOrderBId}`)
      .set('Authorization', `Bearer ${doctorAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('LAB_ORDER_NOT_FOUND');
  });

  it('Hospital B’s lab technician cannot collect a specimen for Hospital A’s lab order item', async () => {
    const res = await request(server)
      .post(`/api/v1/lab-order-items/${labOrderItemAId}/collect`)
      .set('Authorization', `Bearer ${labTechBToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('LAB_ORDER_ITEM_NOT_FOUND');
  });

  it('Hospital A cannot read Hospital B’s lab result', async () => {
    const res = await request(server)
      .get(`/api/v1/lab-results/${labResultBId}`)
      .set('Authorization', `Bearer ${doctorAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('LAB_RESULT_NOT_FOUND');
  });

  it('Hospital A cannot read Hospital B’s medicine', async () => {
    const res = await request(server)
      .get(`/api/v1/medicines/${medicineBId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('MEDICINE_NOT_FOUND');
  });

  it('Hospital A cannot read Hospital B’s stock batch', async () => {
    const res = await request(server)
      .get(`/api/v1/stock-batches/${stockBatchBId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('STOCK_BATCH_NOT_FOUND');
  });

  it('Hospital A cannot read Hospital B’s service', async () => {
    const res = await request(server)
      .get(`/api/v1/services/${serviceBId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });

  it('Hospital A cannot read Hospital B’s invoice', async () => {
    const res = await request(server)
      .get(`/api/v1/invoices/${invoiceBId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('INVOICE_NOT_FOUND');
  });

  it('Hospital A cannot read Hospital B’s payment', async () => {
    const res = await request(server)
      .get(`/api/v1/payments/${paymentBId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('is symmetric: Hospital B cannot reach Hospital A either (encounter + invoice)', async () => {
    const encounterRes = await request(server)
      .get(`/api/v1/encounters/${encounterAId}`)
      .set('Authorization', `Bearer ${doctorBToken}`)
      .expect(404);
    expect(encounterRes.body.error.code).toBe('ENCOUNTER_NOT_FOUND');

    const invoiceRes = await request(server)
      .get(`/api/v1/invoices/${invoiceAId}`)
      .set('Authorization', `Bearer ${adminBToken}`)
      .expect(404);
    expect(invoiceRes.body.error.code).toBe('INVOICE_NOT_FOUND');
  });
});
