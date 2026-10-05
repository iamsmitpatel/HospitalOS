import { Injectable, Logger } from '@nestjs/common';
import { AuditOutcome } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActionType } from './audit.constants';

export interface AuditLogInput {
  action: AuditActionType;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  hospitalId?: string | null;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  correlationId?: string;
  /** Non-sensitive structured context only — never pass passwords, tokens, OTPs, or clinical data. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          outcome: input.outcome,
          actorUserId: input.actorUserId ?? null,
          hospitalId: input.hospitalId ?? null,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          ipAddress: input.ipAddress,
          correlationId: input.correlationId,
          metadata: input.metadata as object | undefined,
        },
      });
    } catch (error) {
      // Audit logging must never take down the primary request path.
      // A failure here is itself an operational concern worth surfacing to logs.
      this.logger.error(
        `Failed to write audit log for action ${input.action}: ${(error as Error).message}`,
      );
    }
  }
}
