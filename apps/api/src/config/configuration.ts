export interface AppConfig {
  nodeEnv: string;
  port: number;
  globalPrefix: string;
  databaseUrl: string;
  redisUrl: string;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  bcryptSaltRounds: number;
  corsOrigin: string;
  authThrottle: {
    ttlSeconds: number;
    limit: number;
  };
  defaultThrottle: {
    ttlSeconds: number;
    limit: number;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  globalPrefix: process.env.API_GLOBAL_PREFIX ?? 'api',
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
  authThrottle: {
    ttlSeconds: parseInt(process.env.AUTH_THROTTLE_TTL_SECONDS ?? '60', 10),
    limit: parseInt(process.env.AUTH_THROTTLE_LIMIT ?? '10', 10),
  },
  // The global per-route-per-IP budget (master doc Part 5 "rate limiting").
  // Deliberately far more generous than authThrottle: it exists to blunt
  // basic flooding/DoS, not to rate-limit normal use — a patient polling
  // GET /patient/queue or browsing GET /discover/hospitals must never hit
  // this. The STRICT brute-force budget (authThrottle) is applied only to
  // login/register/register-patient/refresh via @Throttle() overrides —
  // see auth.controller.ts.
  defaultThrottle: {
    ttlSeconds: parseInt(process.env.DEFAULT_THROTTLE_TTL_SECONDS ?? '60', 10),
    limit: parseInt(process.env.DEFAULT_THROTTLE_LIMIT ?? '120', 10),
  },
});
