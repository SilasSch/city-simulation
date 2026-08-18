import { z } from 'zod';

const clientOriginSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        message: 'must use the http or https protocol',
      });
    }
    if (url.username || url.password) {
      context.addIssue({
        code: 'custom',
        message: 'must not contain credentials',
      });
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      context.addIssue({
        code: 'custom',
        message: 'must contain only scheme, host, and optional port',
      });
    }
  })
  // URL.origin normalisiert u. a. Host-Schreibweise, Default-Port und Slash.
  .transform((value) => new URL(value).origin);

/**
 * Zentrale Laufzeit-Validierung der Server-Konfiguration.
 * Schlägt die Validierung fehl, startet der Server nicht (fail fast).
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    SERVER_PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    CLIENT_ORIGIN: clientOriginSchema.default('http://localhost:4200'),
    // Lebensdauer einer Session in Stunden (fester Ablauf, kein Sliding).
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
    // Secure-Flag des Session-Cookies. Lokal false (HTTP), in Produktion true.
    SESSION_COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && !config.SESSION_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnv(env: NodeJS.ProcessEnv): AppConfig {
  if (env.NODE_ENV === 'production' && env.CLIENT_ORIGIN === undefined) {
    throw new Error(
      'Invalid server configuration: CLIENT_ORIGIN: must be explicitly set in production',
    );
  }

  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  return result.data;
}
