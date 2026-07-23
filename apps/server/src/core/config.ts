import { z } from 'zod';

/**
 * Zentrale Laufzeit-Validierung der Server-Konfiguration.
 * Schlägt die Validierung fehl, startet der Server nicht (fail fast).
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:4200'),
  // Lebensdauer einer Session in Stunden (fester Ablauf, kein Sliding).
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  // Secure-Flag des Session-Cookies. Lokal false (HTTP), in Produktion true.
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnv(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  return result.data;
}
