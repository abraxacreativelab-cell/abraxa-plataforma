/**
 * De qué llave se usa para cada agente.
 *
 *   fila.key_ref → app.tenant_integrations (H2)  →  llave del cliente
 *          null  →                                  llave de la plataforma
 *
 * ── Sobre `app.tenant_integrations` ────────────────────────────────────────
 *
 * Esa tabla la nombra el handoff de H3 como "de H2/H4", pero al 2026-07-30 no
 * aparece en el alcance ni en el rango de migraciones de ninguno de los dos.
 * Está anotado en el PR para que H0 le asigne dueño.
 *
 * Mientras tanto este archivo funciona con o sin ella: si no existe, o si el
 * `key_ref` no resuelve, se cae a la llave de la plataforma. Un `key_ref` que
 * no resuelve NO es un error fatal — pero sí deja rastro en el log, porque un
 * cliente que cree estar pagando con su propia cuenta y en realidad usa la
 * nuestra es un problema de facturación silencioso.
 *
 * ── Aislamiento ────────────────────────────────────────────────────────────
 *
 * La lectura va por `tenantDb(ctx)`: un `key_ref` del tenant A jamás puede
 * resolver a la credencial del tenant B, aunque alguien lograra escribir el
 * nombre correcto en la fila de A.
 */
import { tenantDb, PlatformError } from '@abraxa/db';
import type { ProviderName, TenantContext } from '@abraxa/db';
import { env } from '@abraxa/config';
import { log } from '../logger';

/**
 * La llave para una corrida.
 *
 * @throws PlatformError('PROVIDER_ERROR') si no hay ninguna llave utilizable.
 */
export async function resolverLlave(
  ctx: TenantContext,
  provider: ProviderName,
  keyRef: string | null,
): Promise<string> {
  if (keyRef) {
    const propia = await llaveDelTenant(ctx, keyRef);
    if (propia) return propia;
    log.warn(
      `el agente apunta a key_ref='${keyRef}' pero no se pudo resolver; ` +
        `se usa la llave de la plataforma. Revisa app.tenant_integrations del tenant.`,
    );
  }

  const plataforma = llaveDePlataforma(provider);
  if (plataforma) return plataforma;

  throw new PlatformError(
    'PROVIDER_ERROR',
    `No hay llave para '${provider}'. Configura ${nombreVariable(provider)} en el .env ` +
      `del servidor, o dale al tenant su propia credencial en app.tenant_integrations.`,
    { retryable: false, details: { provider } },
  );
}

function nombreVariable(provider: ProviderName): string {
  return provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
}

function llaveDePlataforma(provider: ProviderName): string | null {
  try {
    const e = env();
    const v = provider === 'openrouter' ? e.OPENROUTER_API_KEY : e.ANTHROPIC_API_KEY;
    return v && v.length > 0 ? v : null;
  } catch {
    // `env()` valida de forma perezosa y lanza si falta lo obligatorio. En un
    // test o un build sin secretos eso es normal y no debe tumbar nada.
    return null;
  }
}

/**
 * Credencial del cliente.
 *
 * Tolerante a que la tabla no exista todavía: cualquier fallo devuelve `null` y
 * el llamador cae a la llave de la plataforma. Es la regla 5 en la práctica —
 * se programa contra lo que H2 va a entregar sin bloquearse en que exista.
 */
async function llaveDelTenant(ctx: TenantContext, keyRef: string): Promise<string | null> {
  try {
    const { data, error } = await tenantDb(ctx)
      // @ts-expect-error — `tenant_integrations` es de H2 y todavía no está en
      // el DomainTableRegistry. H3 no puede declararla (no es su tabla) ni
      // esperar a que exista (regla 5). Cuando H2 la declare, esta línea deja
      // de necesitar el silenciador y el `catch` de abajo se vuelve inalcanzable.
      .from('tenant_integrations')
      .select('credentials')
      .eq('provider_key', keyRef)
      .limit(1);

    if (error) return null;

    const fila = (data as Array<{ credentials?: { api_key?: string } }> | null)?.[0];
    const llave = fila?.credentials?.api_key;
    return typeof llave === 'string' && llave.length > 0 ? llave : null;
  } catch {
    return null;
  }
}
