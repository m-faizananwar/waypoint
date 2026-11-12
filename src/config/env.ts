import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_JWKS_URI: z.preprocess(emptyToUndefined, z.string().url().optional()),
  LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  LLM_MODEL: z.string().default('gpt-4.1-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  TRIAGE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
});

export type Env = z.infer<typeof envSchema>;

/** Fails fast at boot with every bad variable listed, instead of failing on first use. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
