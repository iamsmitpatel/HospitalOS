import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckError,
  HealthCheckService,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import type Redis from 'ioredis';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { MetricsService } from '../metrics/metrics.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly metricsService: MetricsService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.checkDatabase(), () => this.checkRedis()]);
  }

  /**
   * Liveness: "is the Node process itself alive and able to respond" —
   * deliberately checks NOTHING external. A naive orchestrator pointed at
   * the combined /health above would restart this container on a transient
   * database blip, even though the process is fine and the DB will recover
   * on its own — that's what /health/ready is for instead. See /DECISIONS.md.
   */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: "can this instance actually serve traffic right now" —
   * checks the same dependencies as the combined /health. A failure here
   * should pull the instance out of a load balancer's rotation, not kill it.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.checkDatabase(), () => this.checkRedis()]);
  }

  /**
   * Prometheus scrape target. Bypasses the global ResponseInterceptor's
   * {success,data,message} JSON envelope on purpose via @Res() — a scraper
   * expects the exact text/plain exposition format, not wrapped JSON. In
   * production this should be reachable only from the metrics-collection
   * network, not the public internet — it carries no secrets, but it's
   * meant for scrapers, not browsers, and @Public() here is about bypassing
   * JWT (a scraper has no user token), not about public exposure.
   */
  @Public()
  @Get('metrics')
  metrics(@Res() res: Response): void {
    res.type('text/plain; version=0.0.4').send(this.metricsService.renderPrometheusText());
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up' } };
    } catch (error) {
      throw new HealthCheckError('Database check failed', {
        database: { status: 'down', message: (error as Error).message },
      });
    }
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Unexpected ping response: ${pong}`);
      }
      return { redis: { status: 'up' } };
    } catch (error) {
      throw new HealthCheckError('Redis check failed', {
        redis: { status: 'down', message: (error as Error).message },
      });
    }
  }
}
