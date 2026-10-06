import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { createTestApp, resetDatabase } from './utils/test-app';

/**
 * Phase 4 concurrency guarantees, same style as patient-mrn-concurrency and
 * queue-concurrency (master doc §84): real simultaneous HTTP requests
 * against a live DB, asserting the atomic-decrement / idempotency
 * primitives actually hold under contention rather than just in a mocked
 * unit test.
 *
 *  1. Inventory never oversells: N concurrent dispenses against a single
 *     small stock batch — the sum actually dispensed never exceeds what
 *     was received, and quantityRemaining never goes negative
 *     (stock-batches.service.ts applyMovement / dispense.service.ts FEFO
 *     loop, both built on a conditional updateMany).
 *  2. Payment idempotency: N concurrent POST /payments with the same
 *     idempotencyKey credit the invoice exactly once, not N times
 *     (payments.service.ts create()).
 */
describe('Phase 4 concurrency guarantees (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const password = 'TestPass123';

  let adminToken: string;
  let pharmacistToken: string;
  let medicineId: string;
  let encounterPatientId: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetDatabase(app);

    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'root@hospitalos.dev', password, firstName: 'Root', lastName: 'Admin' })
      .expect(201);
    const superAdminToken = registerRes.body.data.accessToken;

    const hospitalRes = await request(server)
      .post('/api/v1/hospitals')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Concurrency Clinical Hospital', slug: 'conc-clinical', code: 'CCL' })
      .expect(201);
    const hospitalId = hospitalRes.body.data.id;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'admin@conc-clinical.dev',
        password,
        firstName: 'Admin',
        lastName: 'A',
        role: 'HOSPITAL_ADMIN',
        hospitalId,
      })
      .expect(201);
    adminToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@conc-clinical.dev', password })
        .expect(200)
    ).body.data.accessToken;

    await request(server)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'pharmacist@conc-clinical.dev',
        password,
        firstName: 'Pharm',
        lastName: 'A',
        role: 'PHARMACIST',
      })
      .expect(201);
    pharmacistToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'pharmacist@conc-clinical.dev', password })
        .expect(200)
    ).body.data.accessToken;

    const patientRes = await request(server)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Stock',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'OTHER',
        phone: '+91 9800000001',
      })
      .expect(201);
    encounterPatientId = patientRes.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('inventory never oversells under concurrent dispensing', () => {
    const CONCURRENT_DISPENSES = 20;
    const UNITS_PER_REQUEST = 3;
    const STOCK_RECEIVED = 50; // Deliberately not a multiple of UNITS_PER_REQUEST * CONCURRENT_DISPENSES (60).

    it(`never dispenses more than the ${STOCK_RECEIVED} units received across ${CONCURRENT_DISPENSES} concurrent requests of ${UNITS_PER_REQUEST} each`, async () => {
      const medicineRes = await request(server)
        .post('/api/v1/medicines')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Contested Medicine' })
        .expect(201);
      medicineId = medicineRes.body.data.id;

      await request(server)
        .post(`/api/v1/medicines/${medicineId}/stock-batches`)
        .set('Authorization', `Bearer ${pharmacistToken}`)
        .send({
          batchNumber: 'B-CONC-001',
          quantityReceived: STOCK_RECEIVED,
          expiryDate: '2030-01-01',
        })
        .expect(201);

      // Build CONCURRENT_DISPENSES independent prescriptions (each with one
      // item of UNITS_PER_REQUEST) so the race is purely on shared stock,
      // not on the EXCEEDS_PRESCRIBED_QUANTITY guard for a single item.
      const prescriptionItemIds = await Promise.all(
        Array.from({ length: CONCURRENT_DISPENSES }, async (_, i) => {
          // A fresh DRAFT prescription needs its own encounter+appointment in
          // this schema; walk-ins avoid the queue/appointment ceremony.
          const doctorUserRes = await request(server)
            .post('/api/v1/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
              email: `conc-doctor-${i}@conc-clinical.dev`,
              password,
              firstName: 'Doc',
              lastName: String(i),
              role: 'DOCTOR',
            })
            .expect(201);
          const deptRes = await request(server)
            .post('/api/v1/departments')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: `Dept ${i}`, code: `D${i}` })
            .expect(201);
          await request(server)
            .post('/api/v1/doctors')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
              userId: doctorUserRes.body.data.id,
              departmentId: deptRes.body.data.id,
              specialization: 'General',
            })
            .expect(201);
          const doctorToken = (
            await request(server)
              .post('/api/v1/auth/login')
              .send({ email: `conc-doctor-${i}@conc-clinical.dev`, password })
              .expect(200)
          ).body.data.accessToken;

          const encounterRes = await request(server)
            .post('/api/v1/encounters')
            .set('Authorization', `Bearer ${doctorToken}`)
            .send({ patientId: encounterPatientId })
            .expect(201);

          const prescriptionRes = await request(server)
            .post(`/api/v1/encounters/${encounterRes.body.data.id}/prescriptions`)
            .set('Authorization', `Bearer ${doctorToken}`)
            .send({
              items: [
                {
                  medicineId,
                  dosage: '1',
                  frequency: '1',
                  duration: '1',
                  quantity: UNITS_PER_REQUEST,
                },
              ],
            })
            .expect(201);
          await request(server)
            .post(`/api/v1/prescriptions/${prescriptionRes.body.data.id}/finalize`)
            .set('Authorization', `Bearer ${doctorToken}`)
            .expect(200);

          return prescriptionRes.body.data.items[0].id as string;
        }),
      );

      const dispenseAttempts = prescriptionItemIds.map((prescriptionItemId) =>
        request(server)
          .post('/api/v1/dispense-records')
          .set('Authorization', `Bearer ${pharmacistToken}`)
          .send({ prescriptionItemId, quantity: UNITS_PER_REQUEST }),
      );
      const results = await Promise.all(dispenseAttempts);

      const succeeded = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status !== 201);
      // Exactly floor(50/3) = 16 requests can be satisfied; the rest must
      // fail cleanly with INSUFFICIENT_STOCK, never with a crash or a
      // silently-wrong partial dispense.
      expect(succeeded.length).toBe(Math.floor(STOCK_RECEIVED / UNITS_PER_REQUEST));
      expect(rejected.every((r) => r.body.error?.code === 'INSUFFICIENT_STOCK')).toBe(true);

      const totalDispensed = succeeded.length * UNITS_PER_REQUEST;
      const batchesRes = await request(server)
        .get(`/api/v1/medicines/${medicineId}/stock-batches`)
        .set('Authorization', `Bearer ${pharmacistToken}`)
        .expect(200);
      const remaining = batchesRes.body.data[0].quantityRemaining;

      expect(remaining).toBe(STOCK_RECEIVED - totalDispensed);
      expect(remaining).toBeGreaterThanOrEqual(0);
    }, 60000);
  });

  describe('payment idempotency under concurrent retries', () => {
    const CONCURRENT_RETRIES = 10;

    it(`credits the invoice exactly once across ${CONCURRENT_RETRIES} concurrent requests with the same idempotency key`, async () => {
      const invoiceRes = await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: encounterPatientId,
          items: [{ description: 'Idempotency test fee', unitPrice: 100, quantity: 1 }],
        })
        .expect(201);
      const invoiceId = invoiceRes.body.data.id;
      await request(server)
        .post(`/api/v1/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const idempotencyKey = `retry-key-${invoiceId}`;
      const attempts = Array.from({ length: CONCURRENT_RETRIES }, () =>
        request(server)
          .post('/api/v1/payments')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ invoiceId, amount: 100, method: 'CASH', idempotencyKey }),
      );
      const results = await Promise.all(attempts);

      expect(results.every((r) => r.status === 201)).toBe(true);
      const paymentIds = new Set(results.map((r) => r.body.data.id));
      // Every retry must resolve to the SAME payment row, not a new one each time.
      expect(paymentIds.size).toBe(1);

      const invoiceAfterRes = await request(server)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      // Credited once (100), never CONCURRENT_RETRIES times (1000).
      expect(invoiceAfterRes.body.data.amountPaid).toBe('100');
      expect(invoiceAfterRes.body.data.status).toBe('PAID');
    }, 30000);
  });
});
