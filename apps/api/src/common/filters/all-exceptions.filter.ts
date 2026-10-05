import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { AppException } from '../exceptions/app.exception';
import { RequestWithCorrelationId } from '../middleware/correlation-id.middleware';

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
  };
  correlationId?: string;
}

const STATUS_CODE_MAP: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
};

/**
 * Catches everything. Never forwards stack traces, raw database errors, or
 * internal file paths to the client (see /SECURITY.md) — those go to the
 * server log only, keyed by correlationId for support/debugging.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithCorrelationId>();
    const correlationId = request?.correlationId;

    const { status, code, message, logAsError } = this.resolve(exception);

    if (logAsError) {
      this.logger.error(
        `[${correlationId ?? 'no-correlation-id'}] ${request?.method} ${request?.url} -> ${status} ${code}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const envelope: ErrorEnvelope = {
      success: false,
      error: { code, message },
      correlationId,
    };

    response.status(status).json(envelope);
  }

  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    logAsError: boolean;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        logAsError: false,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : Array.isArray((body as { message?: unknown }).message)
            ? (body as { message: string[] }).message.join('; ')
            : ((body as { message?: string }).message ?? exception.message);

      return {
        status,
        code: STATUS_CODE_MAP[status] ?? 'HTTP_ERROR',
        message,
        logAsError: status >= HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          code: 'RESOURCE_CONFLICT',
          message: 'A record with the given unique field already exists.',
          logAsError: false,
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'The requested resource was not found.',
          logAsError: false,
        };
      }
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'DATABASE_ERROR',
        message: 'A database error occurred.',
        logAsError: true,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      logAsError: true,
    };
  }
}
