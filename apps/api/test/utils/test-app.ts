import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/prisma/prisma.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Wipes all tables between test files. Only ever point this at hospitalos_test. */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  // Children before parents to satisfy FK constraints (Restrict on most
  // relations means deletion order matters — see /DATABASE.md). Phase 4
  // tables are wiped before the Phase 3 tables they reference.
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.refreshToken.deleteMany(),
    // Payments/Billing
    prisma.refund.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoiceItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.servicePrice.deleteMany(),
    prisma.service.deleteMany(),
    // Pharmacy
    prisma.dispenseRecord.deleteMany(),
    prisma.stockMovement.deleteMany(),
    prisma.stockBatch.deleteMany(),
    prisma.medicine.deleteMany(),
    // Laboratory
    prisma.labResult.deleteMany(),
    prisma.labOrderItem.deleteMany(),
    prisma.labOrder.deleteMany(),
    prisma.labTest.deleteMany(),
    // Clinical
    prisma.prescriptionItem.deleteMany(),
    prisma.prescription.deleteMany(),
    prisma.diagnosis.deleteMany(),
    prisma.clinicalNote.deleteMany(),
    prisma.vitalSigns.deleteMany(),
    prisma.encounter.deleteMany(),
    // Phase 3
    prisma.queueEntry.deleteMany(),
    prisma.queue.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.doctorUnavailability.deleteMany(),
    prisma.doctorSchedule.deleteMany(),
    prisma.doctorProfile.deleteMany(),
    prisma.department.deleteMany(),
    prisma.patient.deleteMany(),
    prisma.user.deleteMany(),
    prisma.hospital.deleteMany(),
  ]);
}
