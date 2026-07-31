/* eslint-disable @typescript-eslint/no-explicit-any --
 * El cliente es deliberadamente NO tipado contra un `Database` generado.
 * Si existiera un tipo central de la base, las 14 conversaciones tendrían que
 * regenerarlo cada vez que alguien agrega una tabla — y ese archivo se
 * volvería el punto de colisión número uno del repo. En su lugar, cada paquete
 * declara las interfaces de SUS filas dentro de su propio carril.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@abraxa/config';
import { APP_SCHEMA } from './tables';

export type AnyClient = SupabaseClient<any, any, any>;

let client: AnyClient | null = null;

/**
 * Cliente con service_role, apuntado al schema `app`.
 *
 * service_role hace BYPASS de RLS: RLS es la red de abajo, no la de arriba.
 * La red de arriba es `tenantDb(ctx)` — y por eso esta función es privada al
 * paquete y ESLint prohíbe importarla desde cualquier otro lado.
 */
export function serviceClient(): AnyClient {
  if (client) return client;
  const e = env();
  client = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: APP_SCHEMA },
    global: { headers: { 'x-application-name': 'abraxa-plataforma' } },
  });
  return client;
}

/**
 * Acceso SIN filtro de tenant.
 *
 * Existe porque hay trabajo legítimo que no puede estar aislado por tenant:
 * dar de alta un tenant (H2), leer `app.plans`, `app.users`,
 * `app.industry_templates`, o registrar un `app.billing_events` que llega
 * ANTES de que el tenant exista (H10).
 *
 * Fuera de eso, no. ESLint lo prohíbe dentro de `routes/` y `services/`, y si
 * lo usas en otro lado deja un comentario diciendo por qué.
 */
export function adminDb(): AnyClient {
  return serviceClient();
}

/** Sólo para pruebas: inyecta un doble y devuelve la función que lo quita. */
export function __setClientForTests(fake: AnyClient | null): () => void {
  const previo = client;
  client = fake;
  return () => {
    client = previo;
  };
}
