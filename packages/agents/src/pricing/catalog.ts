/**
 * Catálogo de precios: la fila de `app.model_pricing` vigente para un modelo
 * en una fecha.
 *
 * `app.model_pricing` es una tabla GLOBAL (no lleva `tenant_id`): el precio de
 * un modelo es el mismo para todos los clientes. Por eso se lee con `adminDb()`
 * y no con `tenantDb(ctx)`. Es el caso que la regla de ESLint contempla — este
 * archivo no vive en `routes/` ni en `services/` justamente porque ahí adentro
 * todo tiene que pasar por el cliente acotado al tenant.
 */
// `adminDb` y no `tenantDb`: `app.model_pricing` es catálogo global de la
// plataforma, declarado `-- tenantless:` en la migración 021. No hay
// `tenant_id` por el que acotar.
import { adminDb } from '@abraxa/db';
import type { ProviderName } from '@abraxa/db';
import { TTL_CACHE_PRECIOS_MS } from '../config';

/** Una fila de `app.model_pricing`, en USD por millón de tokens. */
export interface PricingRow {
  id: string;
  provider: ProviderName;
  model: string;
  inputPerMtok: number;
  outputPerMtok: number;
  cacheWrite5mPerMtok: number;
  cacheWrite1hPerMtok: number;
  cacheReadPerMtok: number;
  currency: string;
  effectiveFrom: string;
}

export interface PricingCatalog {
  /** La fila vigente, o `null` si ese modelo no tiene precio capturado. */
  lookup(provider: ProviderName, model: string, at?: Date): Promise<PricingRow | null>;
  /** Vacía el caché en memoria. Para pruebas y para después de un cambio de precio. */
  invalidate(): void;
}

interface FilaCruda {
  id: string;
  provider: string;
  model: string;
  input_per_mtok: string | number;
  output_per_mtok: string | number;
  cache_write_5m_per_mtok: string | number;
  cache_write_1h_per_mtok: string | number;
  cache_read_per_mtok: string | number;
  currency: string;
  effective_from: string;
}

/**
 * `numeric` de Postgres llega como string por PostgREST — a propósito, para no
 * perder precisión en el camino. Aquí se convierte una sola vez.
 */
function num(v: string | number): number {
  return typeof v === 'number' ? v : Number.parseFloat(v);
}

function mapear(f: FilaCruda): PricingRow {
  return {
    id: f.id,
    provider: f.provider as ProviderName,
    model: f.model,
    inputPerMtok: num(f.input_per_mtok),
    outputPerMtok: num(f.output_per_mtok),
    cacheWrite5mPerMtok: num(f.cache_write_5m_per_mtok),
    cacheWrite1hPerMtok: num(f.cache_write_1h_per_mtok),
    cacheReadPerMtok: num(f.cache_read_per_mtok),
    currency: f.currency,
    effectiveFrom: f.effective_from,
  };
}

interface Entrada {
  fila: PricingRow | null;
  expira: number;
}

/**
 * Catálogo contra la base, con caché corto en memoria.
 *
 * `now` es inyectable porque el precio depende de la FECHA: Sonnet 5 tiene un
 * precio introductorio hasta el 2026-08-31 y otro después, y esa transición
 * tiene que ser probable sin esperar a septiembre.
 */
export function createPricingCatalog(opts?: { now?: () => Date }): PricingCatalog {
  const ahora = opts?.now ?? ((): Date => new Date());
  const cache = new Map<string, Entrada>();

  return {
    async lookup(provider, model, at) {
      const fecha = at ?? ahora();
      const dia = fecha.toISOString().slice(0, 10);
      const llave = `${provider}::${model}::${dia}`;

      const cacheada = cache.get(llave);
      if (cacheada && cacheada.expira > Date.now()) return cacheada.fila;

      const { data, error } = await adminDb()
        .from('model_pricing')
        .select('*')
        .eq('provider', provider)
        .eq('model', model)
        .lte('effective_from', dia)
        // La más reciente que ya entró en vigor. Es lo que hace que agregar el
        // precio de septiembre no rompa el de hoy.
        .order('effective_from', { ascending: false })
        .limit(1);

      if (error) throw error;

      const cruda = (data as FilaCruda[] | null)?.[0];
      const fila = cruda ? mapear(cruda) : null;

      cache.set(llave, { fila, expira: Date.now() + TTL_CACHE_PRECIOS_MS });
      return fila;
    },

    invalidate() {
      cache.clear();
    },
  };
}

/**
 * Catálogo en memoria a partir de filas dadas. Para pruebas y para el guion de
 * verificación de precios: mismo comportamiento de vigencia por fecha, sin base.
 */
export function createStaticPricingCatalog(filas: PricingRow[]): PricingCatalog {
  return {
    lookup(provider, model, at) {
      const dia = (at ?? new Date()).toISOString().slice(0, 10);
      const candidatas = filas
        .filter((f) => f.provider === provider && f.model === model && f.effectiveFrom <= dia)
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
      return Promise.resolve(candidatas[0] ?? null);
    },
    invalidate() {
      /* nada que invalidar */
    },
  };
}
