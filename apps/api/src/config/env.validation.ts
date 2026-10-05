import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),
  API_GLOBAL_PREFIX: Joi.string().default('api'),

  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_TTL: Joi.string().default('7d'),

  BCRYPT_SALT_ROUNDS: Joi.number().min(10).max(15).default(12),

  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),

  AUTH_THROTTLE_TTL_SECONDS: Joi.number().default(60),
  AUTH_THROTTLE_LIMIT: Joi.number().default(10),
});
