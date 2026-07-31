/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El doble de `TenancyPort.provision()` — y por qué el anterior no servía.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El doble que había antes era esta línea:
 *
 *      provisionImpl = async ({ slug }) => ({ tenantId: `tenant-de-${slug}`, created: true });
 *
 *  Nunca escribía en `db.tabla('tenants')`. Consecuencia: la consulta de
 *  "¿está ocupado este slug?" contestaba `false` SIEMPRE, en todas las
 *  pruebas, pasara lo que pasara antes. Y con eso, la prueba
 *
 *      «un alta que quedó a MEDIAS se completa en el reintento»
 *      → expect(new Set(provisionLlamadas.map(p => p.slug)).size).toBe(1)
 *
 *  pasaba en verde afirmando exactamente lo contrario de lo que Postgres iba a
 *  hacer: en producción el reintento veía el slug ocupado (por él mismo) y
 *  creaba una SEGUNDA empresa. La aserción no era falsa del doble — era
 *  verdadera del doble e irrelevante. Lo delataba que `db.tabla('tenants')`
 *  tuviera `toHaveLength(0)` en la única prueba que la miraba: esa tabla no
 *  recibía una fila jamás.
 *
 *  Este doble sí implementa las tres respuestas de `app.provision_tenant`
 *  (migración 011), que son las que el contrato del port promete:
 *
 *    · slug libre              → lo crea, `created: true`
 *    · slug del MISMO dueño    → el MISMO tenantId, `created: false`
 *    · slug de OTRO dueño      → PlatformError CONFLICT (el ABX01 de la base)
 *
 *  Y una cuarta cosa, que también estaba de más en el doble anterior: la fila
 *  nace con `plan = 'free'`. Es literal en `app.provision_tenant` —`p_plan
 *  DEFAULT 'free'`— y el `TenancyPort` de hoy NO tiene por dónde pedirle otro:
 *  `ProvisionInput` no lleva `plan`. Sin esa columna en el doble, la pregunta
 *  «¿en qué plan queda el que acaba de pagar?» no se podía ni formular, y la
 *  respuesta de producción era `free`. Ver el hallazgo C del PR #11.
 *
 *  Regla para quien toque esto: un doble que no puede fallar no prueba nada.
 */
import { PlatformError } from '@abraxa/db';
import type { FakeDb } from './fake-db';

export interface LlamadaAProvision {
  slug: string;
  name: string;
  ownerEmail: string;
}

export interface ProvisionDoble {
  /** La implementación que se registra como `TenancyPort.provision`. */
  provision(i: LlamadaAProvision): Promise<{ tenantId: string; created: boolean }>;
  /** Todo lo que se le pidió, en orden. Incluye los intentos que chocaron. */
  readonly llamadas: LlamadaAProvision[];
  /** Sustituye el comportamiento (para probar los caminos de error). */
  cuando(impl: ((i: LlamadaAProvision) => Promise<{ tenantId: string; created: boolean }>) | null): void;
  /** Siembra una empresa que ya existe, con su dueño. */
  sembrarEmpresa(i: {
    slug: string;
    ownerEmail: string;
    tenantId?: string;
    plan?: string;
  }): void;
}

/**
 * El plan con el que nace TODA empresa que pasa por `provision()`.
 *
 * No es una decisión del doble: es el `p_plan DEFAULT 'free'` de la migración
 * 011, y el port no expone por dónde cambiarlo. Quien cobra tiene que
 * subirlo después — ver `asegurarPlanDelTenant()` en `store.ts`.
 */
export const PLAN_AL_NACER = 'free';

/**
 * Un `provision()` respaldado por la tabla `tenants` del doble de base.
 *
 * `tenantId` sigue siendo `tenant-de-<slug>` a propósito: es legible en los
 * mensajes de fallo y deja las aserciones existentes intactas.
 */
export function crearProvisionDoble(db: FakeDb): ProvisionDoble {
  const llamadas: LlamadaAProvision[] = [];
  let sustituto:
    | ((i: LlamadaAProvision) => Promise<{ tenantId: string; created: boolean }>)
    | null = null;

  const buscar = (slug: string): Record<string, unknown> | undefined =>
    db.tabla('tenants').find((f) => f.slug === slug);

  return {
    llamadas,

    cuando(impl) {
      sustituto = impl;
    },

    sembrarEmpresa({ slug, ownerEmail, tenantId, plan }) {
      db.tabla('tenants').push({
        id: tenantId ?? `tenant-de-${slug}`,
        slug,
        name: slug,
        owner_email: ownerEmail,
        plan: plan ?? PLAN_AL_NACER,
      });
    },

    async provision(i) {
      llamadas.push(i);
      if (sustituto) return sustituto(i);

      const existente = buscar(i.slug);
      if (existente) {
        // La regla de la migración 011: idempotente por slug SÓLO si el dueño
        // coincide. Si es de otro, conflicto — devolver el tenant ajeno le
        // entregaría a quien acaba de pagar la empresa de alguien más.
        if (existente.owner_email !== i.ownerEmail) {
          throw new PlatformError(
            'CONFLICT',
            `El slug "${i.slug}" ya está tomado por otra empresa.`,
            { details: { pgCode: 'ABX01' } },
          );
        }
        return { tenantId: existente.id as string, created: false };
      }

      const tenantId = `tenant-de-${i.slug}`;
      db.tabla('tenants').push({
        id: tenantId,
        slug: i.slug,
        name: i.name,
        owner_email: i.ownerEmail,
        // `p_plan DEFAULT 'free'`, y el port no tiene por dónde pedir otro.
        plan: PLAN_AL_NACER,
      });
      return { tenantId, created: true };
    },
  };
}
