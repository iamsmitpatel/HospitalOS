import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const start = process.hrtime.bigint();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Listens for Node's 'finish' event rather than tap()-ing the handler's
    // Observable: by the time any interceptor's tap() callback runs,
    // response.statusCode has NOT yet been set by Nest's own response
    // pipeline (that happens in its internal subscribe callback, which
    // runs AFTER every tap() in the chain for the same emission) — reading
    // it there would silently record the Express default (200) for every
    // non-200 status, including every @HttpCode(201)/404/etc. route.
    // 'finish' fires only once the response is actually fully sent, when
    // statusCode is guaranteed final.
    response.on('finish', () => {
      const route = (request as { route?: { path?: string } }).route?.path ?? request.url;
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metricsService.recordRequest(
        request.method,
        route,
        response.statusCode,
        durationSeconds,
      );
    });

    return next.handle();
  }
}
