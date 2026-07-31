/**
 * El router de proveedores.
 *
 *   fila de app.agent_definitions  →  { provider, model, key_ref }
 *                                          ↓
 *                          ┌─────────────────────────────────┐
 *                          │ anthropic  → Messages API        │
 *                          │ openrouter → modelos baratos     │
 *                          │ local      → modelos propios ←v2 │
 *                          └─────────────────────────────────┘
 *
 * Son doce líneas útiles y ése es justo el punto: todo lo difícil está en los
 * adaptadores, detrás de `ProviderAdapter`. El día que Santiago corra modelos
 * locales, este archivo no cambia.
 */
import { PlatformError } from '@abraxa/db';
import type { ProviderName } from '@abraxa/db';
import { createAnthropicAdapter } from './anthropic';
import { createLocalAdapter } from './local';
import { createOpenRouterAdapter } from './openrouter';
import type { FetchLike, ProviderAdapter } from './types';

export interface ProviderRouter {
  get(provider: ProviderName): ProviderAdapter;
}

/**
 * `fetchImpl` se inyecta hasta abajo. Es lo que permite probar el criterio #2
 * —cambiar `provider` en la fila y que siga funcionando— sin red y sin llaves.
 */
export function createProviderRouter(opts?: {
  fetchImpl?: FetchLike;
  overrides?: Partial<Record<ProviderName, ProviderAdapter>>;
}): ProviderRouter {
  const f = opts?.fetchImpl ?? fetch;

  const adaptadores: Record<ProviderName, ProviderAdapter> = {
    anthropic: opts?.overrides?.anthropic ?? createAnthropicAdapter(f),
    openrouter: opts?.overrides?.openrouter ?? createOpenRouterAdapter(f),
    local: opts?.overrides?.local ?? createLocalAdapter(),
  };

  return {
    get(provider) {
      const a = adaptadores[provider];
      if (!a) {
        // Sólo alcanzable si alguien mete un provider fuera del CHECK de la
        // migración 020. Mejor un error nombrando el valor que un `undefined`
        // reventando tres marcos más arriba.
        throw new PlatformError(
          'PROVIDER_ERROR',
          `Proveedor desconocido: '${String(provider)}'. Válidos: anthropic, openrouter, local.`,
          { retryable: false },
        );
      }
      return a;
    },
  };
}
