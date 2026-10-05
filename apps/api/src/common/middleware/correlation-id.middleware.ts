import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

export interface RequestWithCorrelationId extends Request {
  correlationId: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestWithCorrelationId, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_ID_HEADER);
    req.correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader(CORRELATION_ID_HEADER, req.correlationId);
    next();
  }
}
