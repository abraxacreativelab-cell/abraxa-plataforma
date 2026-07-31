/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La bitácora — y el filtro que impide que se vuelva un almacén de secretos
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Cuando alguien reclame que "conectó su WhatsApp y no funcionó", esto es lo
 *  único que contesta qué pasó.
 *
 *  `limpiarDetalle()` es lo que hace que se pueda guardar sin miedo: recorta a
 *  lo que cabe, tira lo que no es serializable y tacha cualquier rastro del
 *  secreto. La regla de arriba —no meter el cuerpo del proveedor— vive en
 *  `providers/sanear.ts`; ésta es la red de abajo, la que no depende de que
 *  quien escriba el próximo verificador se acuerde.
 */
import { tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import type { IntegrationEvent, IntegrationEventType } from './port';
import { sinSecretos } from './providers/sanear';
import { ahora, lista } from './store';

/** Tope por valor de texto dentro de `detail`. Un motivo largo no aporta. */
const LARGO_MAX_VALOR = 300;
/** Tope de claves. Un `detail` con cincuenta campos ya no se lee: se ignora. */
const MAX_CLAVES = 20;

export interface EntradaEvento {
  integrationId?: string | null;
  provider: string;
  type: IntegrationEventType | (string & Record<never, never>);
  detail?: Record<string, unknown>;
  actor?: string | null;
  /** Los secretos que NO pueden aparecer, para tacharlos si se colaron. */
  secretos?: Array<string | null | undefined>;
}

/**
 * Deja `detail` en algo que se puede escribir: plano, corto y sin secretos.
 *
 * Se aplana en vez de recorrer en profundidad a propósito — un objeto anidado
 * del proveedor es justo lo que no queremos guardar entero.
 */
export function limpiarDetalle(
  detalle: Record<string, unknown> | undefined,
  secretos: Array<string | null | undefined> = [],
): Record<string, unknown> {
  if (!detalle) return {};
  const salida: Record<string, unknown> = {};

  for (const [clave, valor] of Object.entries(detalle).slice(0, MAX_CLAVES)) {
    if (valor === null || valor === undefined) continue;

    if (typeof valor === 'string') {
      salida[clave] = sinSecretos(valor, secretos).slice(0, LARGO_MAX_VALOR);
      continue;
    }
    if (typeof valor === 'number' || typeof valor === 'boolean') {
      salida[clave] = valor;
      continue;
    }
    // Cualquier otra cosa —objetos del proveedor, arreglos, funciones— se
    // resume a su forma. Guardar la estructura completa es exactamente cómo un
    // token acaba en la bitácora dentro de un campo que nadie miró.
    salida[clave] = `«${Array.isArray(valor) ? 'lista' : typeof valor}»`;
  }

  return salida;
}

/**
 * Escribe un evento. **Best effort a propósito:** si la bitácora falla, el
 * trabajo sigue. Una integración que no se pudo registrar es un problema;
 * un WhatsApp que no se conectó porque no se pudo escribir el registro es
 * otro mucho peor.
 */
export async function registrar(ctx: TenantContext, e: EntradaEvento): Promise<void> {
  try {
    await tenantDb(ctx)
      .from('integration_events')
      .insert({
        integration_id: e.integrationId ?? null,
        provider: e.provider,
        type: e.type,
        detail: limpiarDetalle(e.detail, e.secretos),
        actor: e.actor ?? ctx.userEmail ?? null,
        created_at: ahora(),
      });
  } catch (err) {
    console.warn('[integrations] no se pudo escribir la bitácora', {
      provider: e.provider,
      type: e.type,
      error: err instanceof Error ? err.name : 'desconocido',
    });
  }
}

interface FilaEvento {
  id: string | number;
  integration_id: string | null;
  provider: string;
  type: string;
  detail: Record<string, unknown> | null;
  actor: string | null;
  created_at: string;
}

export async function leerEventos(
  ctx: TenantContext,
  i: { integrationId?: string; limit?: number } = {},
): Promise<IntegrationEvent[]> {
  let q = tenantDb(ctx)
    .from('integration_events')
    .select('id,integration_id,provider,type,detail,actor,created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(i.limit ?? 50, 1), 200));

  if (i.integrationId) q = q.eq('integration_id', i.integrationId);

  const filas = lista<FilaEvento>(await q, 'leer la bitácora de integraciones');

  return filas.map((f) => ({
    id: String(f.id),
    integrationId: f.integration_id ?? null,
    provider: f.provider,
    type: f.type,
    detail: (f.detail ?? {}) as Record<string, unknown>,
    actor: f.actor ?? null,
    createdAt: f.created_at,
  }));
}
