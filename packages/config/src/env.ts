import { z } from 'zod';

/**
 * El entorno, validado UNA vez y en el momento en que de verdad se usa.
 *
 * Deliberadamente perezoso: si esto validara al importarse, `npm run build` y
 * los tests de CI reventarían por no tener secretos, y la primera reacción de
 * alguien sería aflojar el esquema. Así, el build no necesita secretos y el
 * runtime sí los exige.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  DATABASE_URL: z.string().min(1).optional(),

  API_PORT: z.coerce.number().int().positive().default(3100),
  API_BASE_URL: z.string().url().default('http://localhost:3100'),
  APP_BASE_URL: z.string().url().default('https://mi.abraxa.club'),
  WEB_PORT: z.coerce.number().int().positive().default(3000),

  /** Secreto compartido BFF↔API. Sin él, en producción la vía de headers se
   *  RECHAZA (fail-closed). Ver H2 §7. */
  PROXY_SECRET: z.string().min(16).optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  EVOLUTION_API_URL: z.string().optional(),
  EVOLUTION_API_KEY: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Entorno validado. Lanza con la lista completa de lo que falta, no de uno en uno. */
export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const faltantes = parsed.error.issues
      .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Entorno inválido. Copia .env.example a .env y llena:\n${faltantes}\n` +
        'Ningún secreto va en el repo — el gate de CI falla si uno entra al diff.',
    );
  }
  cached = parsed.data;
  return cached;
}

/** Sólo para pruebas: obliga a revalidar tras tocar process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';
export const isTest = (): boolean => process.env.NODE_ENV === 'test';
