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
  // Phase 3 relations means deletion order matters — see /DATABASE.md).
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.refreshToken.deleteMany(),
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
