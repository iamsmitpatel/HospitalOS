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
});
