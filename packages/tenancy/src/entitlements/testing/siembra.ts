/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Siembra para las pruebas en memoria de H16.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Se apoya en el doble de PostgREST de H2 (`../../testing/fake-postgrest`), que
 * es deliberadamente PERMISIVO: guarda las filas de todas las empresas juntas y
 * sólo aplica los filtros que el código bajo prueba pide explícitamente. Esa
 * propiedad es lo único que hace que la prueba de aislamiento signifique algo —
 * si una consulta se olvida de acotar por empresa, el doble le entrega
 * encantado las filas del vecino y la prueba falla, que es lo que se quiere.
 *
 * ── LA DECISIÓN IMPORTANTE DE ESTE ARCHIVO ──────────────────────────────────
 *
 * `sembrarEfectivas()` escribe DIRECTO en la vista
 * `app.tenant_entitlements_effective`, ya resuelta. **No** reimplementa en
 * JavaScript la resolución de tres saltos ni la comparación de `expires_at`.
 *
 * Es a propósito, y es la misma línea que H2 trazó cuando su doble se negó a
 * implementar `provision_tenant` en JS (`fake-postgrest.ts:24-31`): si esta
 * siembra calculara la vista, las pruebas en memoria estarían verificando esa
 * reimplementación y no el SQL que corre en producción — y pasarían en verde
 * aunque la vista estuviera mal.
 *
 * El reparto es explícito:
 *
 *   en memoria (este archivo)   el código de TypeScript alrededor de la vista:
 *                               caché, 402 contra 403, la puerta del worker,
 *                               el aislamiento de las consultas que escribimos
 *
 *   pg.test.ts                  la vista misma: deny por defecto, los dos
 *                               sentidos del override, `expires_at` contra
 *                               `now()`, el tenant suspendido, y el ciclo
 *                               completo de impago con `apply_plan_change`
 *
 * Los criterios #1 a #5, #8, #9, #10, #13 y #14 se demuestran contra Postgres
 * de verdad. Aquí se demuestra lo que vive en JavaScript.
 */
// `AlmacenFake` sólo se usa como TIPO aquí: quien lo instancia es
// `instalarDoble()` de H2. Por eso `import type` — y la regla del repo lo exige.
import type { AlmacenFake } from '../../testing/fake-postgrest';
import { instalarDoble as instalarDobleH2 } from '../../testing/seed';
import { invalidarEntitlements } from '../can';
import { FEATURE_KEYS, type EntitlementSource, type OnDowngrade } from '../catalogo';

export { sembrarTenant, sembrarMiembro } from '../../testing/seed';
export type { AlmacenFake } from '../../testing/fake-postgrest';

/**
 * Instala el doble y limpia el caché de entitlements.
 *
 * Esa segunda parte no es higiene: el caché tiene 60 s de TTL y vive en el
 * módulo, así que sin invalidarlo entre casos el segundo test lee lo que dejó
 * el primero y **pasa por la razón equivocada**. Es exactamente la trampa que
 * H3 documentó para `invalidarCachePresupuesto()`, y por eso está aquí y no en
 * cada archivo de prueba: dejarlo a que cada uno se acuerde es garantizar que
 * un día alguien no se acuerde.
 */
export function instalarDoble(): { almacen: AlmacenFake; restaurar: () => void } {
  invalidarEntitlements();
  const r = instalarDobleH2();
  const restaurarH2 = r.restaurar;
  return {
    almacen: r.almacen,
    restaurar: () => {
      invalidarEntitlements();
      restaurarH2();
    },
  };
}

/** Copia del catálogo de la migración 130, para las pruebas que lo necesitan. */
export const CATALOGO: ReadonlyArray<{
  key: string;
  label: string;
  blurb: string;
  on_downgrade: OnDowngrade;
  position: number;
}> = [
  { key: 'inbox.whatsapp', label: 'WhatsApp', blurb: 'Contesta WhatsApp desde la bandeja.', on_downgrade: 'pause', position: 10 },
  { key: 'inbox.meta', label: 'Instagram y Messenger', blurb: 'Instagram y Messenger en la misma bandeja.', on_downgrade: 'pause', position: 20 },
  { key: 'inbox.email', label: 'Correo', blurb: 'Tu correo de atención en la bandeja.', on_downgrade: 'pause', position: 30 },
  { key: 'inbox.sms', label: 'SMS', blurb: 'Mensajes de texto que tienen que llegar.', on_downgrade: 'pause', position: 40 },
  { key: 'inbox.ai_reply', label: 'Respuesta automática del agente', blurb: 'Tu agente contesta solo.', on_downgrade: 'pause', position: 50 },
  { key: 'flows.publish', label: 'Publicar automatizaciones', blurb: 'Deja corriendo un flujo.', on_downgrade: 'pause', position: 60 },
  { key: 'flows.ai_assist', label: 'Asistente de automatizaciones', blurb: 'Descríbelo en español.', on_downgrade: 'keep', position: 70 },
  { key: 'agents.custom', label: 'Agentes propios', blurb: 'Crea agentes con su propia personalidad.', on_downgrade: 'readonly', position: 80 },
  { key: 'vault.ingest', label: 'Ingesta de documentos', blurb: 'Pega un documento y la bóveda lo lee.', on_downgrade: 'readonly', position: 90 },
  { key: 'work.projects', label: 'Proyectos', blurb: 'Agrupa tus tareas en proyectos.', on_downgrade: 'readonly', position: 100 },
  { key: 'crm.pipelines', label: 'Más de un embudo', blurb: 'Un embudo por línea de negocio.', on_downgrade: 'readonly', position: 110 },
  { key: 'team.invite', label: 'Invitar a tu equipo', blurb: 'Suma gente con el acceso justo.', on_downgrade: 'keep', position: 120 },
];

const PORDEF = new Map(CATALOGO.map((f) => [f.key, f]));

export interface EfectivaSembrada {
  granted: boolean;
  source?: EntitlementSource;
  expiresAt?: string | null;
  note?: string | null;
}

/**
 * Siembra la vista ya resuelta para una empresa.
 *
 * Recibe el resultado, no los ingredientes: `{ 'flows.publish': true }` quiere
 * decir "para esta empresa, la vista devuelve granted=true en esa función". Lo
 * que no se nombre se siembra en `false` con `source='none'`, que es el deny por
 * defecto tal como lo produce el SQL.
 */
export function sembrarEfectivas(
  almacen: AlmacenFake,
  tenantId: string,
  estados: Record<string, boolean | EfectivaSembrada>,
): void {
  for (const key of FEATURE_KEYS) {
    const f = PORDEF.get(key);
    if (!f) continue;

    const crudo = estados[key];
    const e: EfectivaSembrada =
      crudo === undefined
        ? { granted: false, source: 'none' }
        : typeof crudo === 'boolean'
          ? { granted: crudo, source: crudo ? 'plan' : 'none' }
          : crudo;

    almacen.sembrar('tenant_entitlements_effective', {
      tenant_id: tenantId,
      feature_key: f.key,
      label: f.label,
      blurb: f.blurb,
      on_downgrade: f.on_downgrade,
      position: f.position,
      granted: e.granted,
      source: e.source ?? (e.granted ? 'plan' : 'none'),
      override_expires_at: e.expiresAt ?? null,
      override_note: e.note ?? null,
    });
  }
}

/**
 * Un tenant suspendido, tal como lo ve la vista: TODO en `false` con
 * `source='tenant_inactive'`, sin mirar el catálogo. Es la regla 3 de §6,
 * sembrada como resultado y verificada de verdad en `pg.test.ts`.
 */
export function sembrarEfectivasSuspendida(almacen: AlmacenFake, tenantId: string): void {
  const apagadas: Record<string, EfectivaSembrada> = {};
  for (const k of FEATURE_KEYS) apagadas[k] = { granted: false, source: 'tenant_inactive' };
  sembrarEfectivas(almacen, tenantId, apagadas);
}

/** Una pausa viva, como la deja `apply_plan_change` o el propio emprendedor. */
export function sembrarPausa(
  almacen: AlmacenFake,
  tenantId: string,
  i: { feature: string; pausedBy: 'plan' | 'user'; resourceRef?: string; note?: string },
): void {
  almacen.sembrar('feature_pauses', {
    id: Math.floor(Math.random() * 1_000_000),
    tenant_id: tenantId,
    feature_key: i.feature,
    resource_ref: i.resourceRef ?? '*',
    paused_by: i.pausedBy,
    note: i.note ?? null,
    created_at: new Date().toISOString(),
    released_at: null,
  });
}
