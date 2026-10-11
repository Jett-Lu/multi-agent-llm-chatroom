import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  FRONTEND_ORIGIN: z.string().url(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(45000).default(12000),
  REQUEST_BODY_LIMIT: z.string().regex(/^\d+(b|kb|mb)$/i, 'REQUEST_BODY_LIMIT must be like 16kb').default('16kb'),
  MAX_PROMPT_CHARS: z.coerce.number().int().min(1).max(10000).default(2000),
  MAX_MESSAGE_CHARS: z.coerce.number().int().min(1).max(10000).default(4000),
  MAX_TURNS: z.coerce.number().int().min(1).max(100).default(20),
  MAX_MESSAGES: z.coerce.number().int().min(1).max(120).default(40),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  UPSTREAM_API_URL: z.string().url(),
  UPSTREAM_MODEL: z.string().min(1).max(128),
  DATABASE_URL: z.string().url().refine(value => /^postgres(ql)?:\/\//.test(value)).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  DB_TIMEOUT_MS: z.coerce.number().int().min(100).max(5000).default(1500),
  TELEMETRY_QUEUE_SIZE: z.coerce.number().int().min(1).max(10000).default(500),
  TELEMETRY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ANALYTICS_LOCAL_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  ANALYTICS_LOCAL_SECRET: z.string().min(32).max(256).optional()
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | null = null;

const assertProductionSecurity = (config: AppConfig): void => {
  if (config.NODE_ENV !== 'production') {
    return;
  }

  if (!config.FRONTEND_ORIGIN.startsWith('https://')) {
    throw new Error('FRONTEND_ORIGIN must use HTTPS in production');
  }

  if (config.RATE_LIMIT_MAX > 100) {
    throw new Error('RATE_LIMIT_MAX is too permissive for production');
  }

  if (config.REQUEST_TIMEOUT_MS > 30000 || config.UPSTREAM_TIMEOUT_MS > config.REQUEST_TIMEOUT_MS) {
    throw new Error('Timeout configuration is insecure for production');
  }

  if (/\*$/.test(config.FRONTEND_ORIGIN)) {
    throw new Error('FRONTEND_ORIGIN wildcard is not allowed in production');
  }

  if (config.REQUEST_BODY_LIMIT.toLowerCase().endsWith('mb')) {
    throw new Error('REQUEST_BODY_LIMIT in production must be in bytes or kb, not mb');
  }
};

export const getConfig = (): AppConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  assertProductionSecurity(parsed.data);
  if (parsed.data.ANALYTICS_LOCAL_ENABLED && (parsed.data.NODE_ENV === 'production' || parsed.data.TRUST_PROXY || !parsed.data.ANALYTICS_LOCAL_SECRET || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(parsed.data.FRONTEND_ORIGIN).hostname))) {
    throw new Error('Local analytics requires development mode, no trusted proxy, a loopback frontend, and a separate admin secret');
  }
  cachedConfig = parsed.data;
  return parsed.data;
};
