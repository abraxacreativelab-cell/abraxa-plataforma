/**
 * Caché de la bóveda: una lectura por tenant cada TTL, no una por mensaje.
 *
 * ── Por qué esto no imita a GARDEN al pie de la letra ───────────────────────
 *
 * GARDEN tenía `notifyVaultChanged()` que llamaba `rpc('pg_notify', …)` para
 * avisarle a los otros procesos. Esa RPC **no existe**: PostgREST no la
 * expone. La llamada siempre fallaba, el `catch` vacío se la tragaba, y el
 * propio comentario del archivo lo admitía — *"sin RPC: la caché de 60s
 * converge sola"*.
 *
 * Un invalidador que miente es peor que no tener ninguno: alguien lee el
 * código, cree que la propagación es inmediata entre procesos, y diseña
 * encima de una garantía que no existe.
 *
 * Aquí se dice la verdad: **el mecanismo entre procesos es el TTL.** Un valor
 * aprobado en la API tarda, en el peor caso, `VAULT_CACHE_TTL_MS` en verse
 * desde el worker. Dentro del mismo proceso la invalidación sí es inmediata.
 *
 * Si algún día hace falta propagación instantánea entre procesos, se enchufa
 * un bus real con `setVaultCacheBroadcaster()` — sin tocar nada más.
 */
import type { TenantMeta, VaultRow } from './types';

/** 60 s, como GARDEN. Ajustable por entorno para pruebas y para el worker. */
export const VAULT_CACHE_TTL_MS = Number(process.env.VAULT_CACHE_TTL_MS ?? 60_000);

interface CacheEntry {
  at: number;
  rows: VaultRow[];
  tenant: TenantMeta;
}

const cache = new Map<string, CacheEntry>();

/** Reloj inyectable: las pruebas de expiración no deberían dormir 60 s. */
let now: () => number = () => Date.now();

export function __setClockForTests(fn: (() => number) | null): void {
  now = fn ?? (() => Date.now());
}

export function readCache(tenantId: string): CacheEntry | null {
  const hit = cache.get(tenantId);
  if (!hit) return null;
  if (now() - hit.at >= VAULT_CACHE_TTL_MS) {
    cache.delete(tenantId);
    return null;
  }
  return hit;
}

export function writeCache(tenantId: string, rows: VaultRow[], tenant: TenantMeta): CacheEntry {
  const entry: CacheEntry = { at: now(), rows, tenant };
  cache.set(tenantId, entry);
  return entry;
}

/** Invalida YA, dentro de este proceso. Sin `tenantId`, invalida todo. */
export function bumpVaultCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * Enchufe para propagar la invalidación a otros procesos.
 * Sin nadie enchufado, `notifyVaultChanged` invalida local y ya — y el resto
 * converge por TTL. Eso está documentado arriba, no escondido.
 */
export type VaultCacheBroadcaster = (tenantId: string) => void | Promise<void>;

let broadcaster: VaultCacheBroadcaster | null = null;

export function setVaultCacheBroadcaster(fn: VaultCacheBroadcaster | null): void {
  broadcaster = fn;
}

/** Se llama tras escribir un valor. Nunca lanza: invalidar no puede tumbar una escritura. */
export async function notifyVaultChanged(tenantId: string): Promise<void> {
  bumpVaultCache(tenantId);
  if (!broadcaster) return;
  try {
    await broadcaster(tenantId);
  } catch (e) {
    console.warn('[vault] el broadcaster de caché falló; converge por TTL:', e);
  }
}
