import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Throw this instead of a bare HttpException when the frontend needs a
 * stable machine-readable error code (e.g. "PATIENT_NOT_FOUND") in addition
 * to the human-readable message.
 */
export class AppException extends HttpException {
  public readonly code: string;

  constructor(code: string, message: string, status: HttpStatus) {
    super({ code, message }, status);
    this.code = code;
  }
}
