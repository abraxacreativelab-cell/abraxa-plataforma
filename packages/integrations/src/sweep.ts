/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EL REPASO PERIÓDICO — el que de verdad importa
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Verificar al conectar atrapa el token mal pegado. Este repaso atrapa lo
 *  otro, que es lo que de verdad rompe el producto sin avisar:
 *
 *    · los tokens de página de Meta CADUCAN;
 *    · un cliente puede revocar el acceso desde su Business Suite;
 *    · un número de Twilio se puede liberar;
 *    · una instancia de Evolution se desconecta cuando el teléfono se apaga.
 *
 *  En los cuatro casos el sistema seguiría diciendo "conectado" y el
 *  emprendedor se enteraría por un cliente enojado. Aquí se entera antes, en su
 *  pantalla.
 *
 *  ── `adminDb()`, y por qué ─────────────────────────────────────────────────
 *
 *  El repaso es de la plataforma entera: no lo dispara la petición de una
 *  empresa, sino una cola, y no hay un `TenantContext` de nadie. Lo que se lee
 *  sin contexto es la LISTA de filas a revisar; en cuanto se tiene una, todo lo
 *  demás —la escritura del estado y la bitácora— vuelve a pasar por
 *  `tenantDb(ctx)` con el contexto armado desde el `tenant_id` de esa misma
 *  fila (`contextoDelSistema`). El acceso sin filtro dura una consulta.
 */
// `adminDb()` con su razón escrita: ver el encabezado. Es una de las dos únicas
// consultas sin contexto del paquete, y sólo para SABER a quién repasar.
import { adminDb } from '@abraxa/db';
import { registrar } from './events';
import { proveedor } from './providers/catalogo';
import { motivo } from './providers/sanear';
import {
  COLUMNAS,
  ahora,
  contextoDelSistema,
  db,
  secretoDe,
  type FilaIntegracion,
} from './store';

export interface ResumenRepaso {
  revisadas: number;
  ok: number;
  fallidas: number;
  caducadas: number;
}

export interface OpcionesRepaso {
  fetchImpl?: typeof fetch;
  /** Cuántas revisar como mucho en una pasada. */
  limite?: number;
}

/**
 * Repasa las credenciales vivas de TODAS las empresas.
 *
 * Nunca borra una fila. Una credencial que dejó de servir en `error` con su
 * motivo es un problema que el emprendedor puede arreglar en dos minutos; una
 * credencial borrada es un misterio.
 */
export async function repasar(o: OpcionesRepaso = {}): Promise<ResumenRepaso> {
  const fetchImpl = o.fetchImpl ?? globalThis.fetch;
  const resumen: ResumenRepaso = { revisadas: 0, ok: 0, fallidas: 0, caducadas: 0 };

  const { data, error } = await adminDb()
    .from('tenant_integrations')
    .select(COLUMNAS)
    .eq('status', 'connected')
    .order('verified_at', { ascending: true })
    .limit(Math.min(Math.max(o.limite ?? 200, 1), 1000));

  if (error) {
    console.error('[integrations] el repaso no pudo leer las integraciones', {
      code: (error as { code?: string }).code ?? null,
    });
    return resumen;
  }

  const cuando = ahora();

  for (const fila of (data ?? []) as FilaIntegracion[]) {
    resumen.revisadas += 1;
    const ctx = contextoDelSistema(fila.tenant_id);

    // 1. Caducada por fecha: no hace falta molestar al proveedor para saberlo.
    if (fila.expires_at && fila.expires_at <= cuando) {
      const razon = motivo([
        'La credencial caducó',
        `venció el ${String(fila.expires_at).slice(0, 10)}`,
        'hay que volver a conectarla',
      ]);
      await db(ctx)
        .from('tenant_integrations')
        .update({ status: 'error', last_error: razon, updated_at: cuando })
        .eq('id', fila.id);
      await registrar(ctx, {
        integrationId: fila.id,
        provider: fila.provider,
        type: 'verify_fail',
        detail: { expired: true, expiresAt: fila.expires_at },
      });
      resumen.caducadas += 1;
      continue;
    }

    // 2. Y si no, se le pregunta al proveedor.
    try {
      const spec = proveedor(fila.provider);
      const secreto = secretoDe(fila) ?? '';
      const r = await spec.verificar({
        secret: secreto,
        config: (fila.config ?? {}) as Record<string, unknown>,
        externalAccountId: fila.external_account_id,
        fetchImpl,
      });

      const patch: Record<string, unknown> = {
        status: r.ok ? 'connected' : 'error',
        last_error: r.ok ? null : motivo([r.reason], [secreto]),
        updated_at: cuando,
      };
      if (r.ok) patch.verified_at = cuando;

      await db(ctx).from('tenant_integrations').update(patch).eq('id', fila.id);
      await registrar(ctx, {
        integrationId: fila.id,
        provider: fila.provider,
        type: r.ok ? 'verify_ok' : 'verify_fail',
        detail: { ...r.detail, sweep: true, reason: r.reason ?? undefined },
        secretos: [secreto],
      });

      if (r.ok) resumen.ok += 1;
      else resumen.fallidas += 1;
    } catch (e) {
      // Una fila que no se puede ni descifrar no tumba el repaso de las demás.
      resumen.fallidas += 1;
      console.error('[integrations] el repaso no pudo comprobar una integración', {
        provider: fila.provider,
        error: e instanceof Error ? e.name : 'desconocido',
      });
    }
  }

  return resumen;
}

/**
 * La cola del repaso, para que la registre el worker.
 *
 * `apps/worker/src/index.ts` dice textual que no se toca: cada paquete llama a
 * `registerQueue()` desde su propio index. Este paquete no puede importar
 * `@abraxa/worker` —el worker depende de los paquetes, no al revés, y meter la
 * flecha contraria haría un ciclo—, así que se exporta el descriptor y el
 * enganche de una línea queda anotado en el PR (§10 del handoff).
 */
export const COLA_DE_REPASO = {
  name: 'integrations.sweep',
  handler: async (): Promise<void> => {
    const r = await repasar();
    console.warn('[integrations] repaso terminado', r);
  },
  options: { pollingIntervalSeconds: 900 },
};
