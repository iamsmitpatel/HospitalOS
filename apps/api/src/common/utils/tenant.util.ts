import { HttpStatus } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AppException } from '../exceptions/app.exception';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Shared tenant-resolution rule (first established in users.service.ts,
 * master doc §8): a non-SUPER_ADMIN actor's own hospitalId is always used,
 * never a client-supplied one. A SUPER_ADMIN must supply an explicit,
 * active hospitalId, since it has no hospital of its own. Used by
 * departments/ and doctors/ — modules judged platform-administration-
 * adjacent (org structure), unlike patients/appointments/queue which
 * exclude SUPER_ADMIN entirely (see /SECURITY.md).
 */
export async function resolveTenantHospitalId(
  prisma: PrismaService,
  actor: AuthenticatedUser,
  suppliedHospitalId: string | undefined,
): Promise<string> {
  if (actor.role !== Role.SUPER_ADMIN) {
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }
    return actor.hospitalId;
  }

  if (!suppliedHospitalId) {
    throw new AppException(
      'HOSPITAL_ID_REQUIRED',
      'hospitalId is required when a SUPER_ADMIN performs this action.',
      HttpStatus.BAD_REQUEST,
    );
  }
  const hospital = await prisma.hospital.findUnique({ where: { id: suppliedHospitalId } });
  if (!hospital || !hospital.isActive) {
    throw new AppException(
      'HOSPITAL_NOT_FOUND',
      'Target hospital not found or inactive.',
      HttpStatus.NOT_FOUND,
    );
  }
  return hospital.id;
}

/**
 * Cross-tenant-read guard for org-structure resources (Department, Doctor)
 * where a platform SUPER_ADMIN legitimately has cross-hospital visibility,
 * same as Users/Hospitals. 404 (not 403) on mismatch so existence in
 * another tenant is never confirmed (§9/§30).
 */
export function assertSameTenant(
  resourceHospitalId: string,
  actor: AuthenticatedUser,
  notFoundCode: string,
  notFoundMessage: string,
): void {
  if (actor.role !== Role.SUPER_ADMIN && resourceHospitalId !== actor.hospitalId) {
    throw new AppException(notFoundCode, notFoundMessage, HttpStatus.NOT_FOUND);
  }
}

/**
 * Strict variant for patient-touching operational data (Patient,
 * Appointment, Queue): NO SUPER_ADMIN bypass. Platform administration does
 * not imply clinical access (§14) — this is the same principle the Phase 2
 * SUPER_ADMIN-patient-access fix established; use this, not the bypassing
 * version above, for anything that touches a specific patient.
 */
export function assertSameTenantStrict(
  resourceHospitalId: string,
  actor: AuthenticatedUser,
  notFoundCode: string,
  notFoundMessage: string,
): void {
  if (resourceHospitalId !== actor.hospitalId) {
    throw new AppException(notFoundCode, notFoundMessage, HttpStatus.NOT_FOUND);
  }
}
