/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Una `apps/api` de mentira con las reglas de verdad.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Existe para poder probar el aislamiento entre invitados en milisegundos y
 *  sin Postgres. Sirve de algo sólo si copia las reglas EXACTAS de la de
 *  verdad, así que aquí está de dónde sale cada una:
 *
 *   · `POST /tenants` toma el dueño de la SESIÓN e ignora el `ownerEmail` del
 *     cuerpo — packages/tenancy/src/routes/index.ts, decisión 2. Por eso el
 *     transporte recibe `correo` y el cuerpo sólo lleva `slug` y `name`.
 *
 *   · El alta es idempotente por slug PARA EL MISMO DUEÑO, y lanza CONFLICT si
 *     el slug existe y es de otro — packages/tenancy/src/services/provision.ts.
 *     Ésa es la regla de la que cuelga todo: si fuera "devuelve el tenant que
 *     encuentres", dos invitados con la misma parte local del correo acabarían
 *     en la misma empresa, y el aislamiento no existiría.
 *
 *   · `GET /tenants/mine` devuelve `{ tenants: TenantSummary[] }`, y un
 *     `TenantSummary` es `{ tenantId, slug, name, role, status }` —
 *     packages/tenancy/src/types.ts:135.
 *
 *  Si alguna de esas tres cambia del otro lado, esto miente y las pruebas se
 *  ponen verdes por la razón equivocada. Por eso está escrito con las
 *  referencias a archivo delante: la próxima persona sabe qué comparar.
 *
 *  No es un archivo de prueba (`*.test.ts`) a propósito: lo comparten varias, y
 *  vitest no recoge un módulo sin pruebas dentro.
 */
import type { PeticionApi, RespuestaApi, Transporte } from './empresa';

export interface FilaTenant {
  slug: string;
  name: string;
  owner: string;
}

export interface FilaMembresia {
  slug: string;
  email: string;
  role: string;
  status: string;
}

export class ApiFalsa {
  readonly tenants: FilaTenant[] = [];
  readonly membresias: FilaMembresia[] = [];
  /** Todo lo que le pidieron, en orden. Sirve para afirmar sobre el camino. */
  readonly llamadas: PeticionApi[] = [];

  /** Fuerza un fallo en la siguiente llamada a la ruta indicada. */
  falloEn: { ruta: string; status: number } | null = null;

  readonly transporte: Transporte = async (p: PeticionApi): Promise<RespuestaApi> => {
    this.llamadas.push(p);

    if (this.falloEn && this.falloEn.ruta === p.ruta) {
      const status = this.falloEn.status;
      this.falloEn = null;
      return { status, cuerpo: { error: { code: 'INTERNAL', message: 'la API se cayó' } } };
    }

    if (p.ruta === '/tenants/mine' && p.metodo === 'GET') return this.mias(p.correo);
    if (p.ruta === '/tenants' && p.metodo === 'POST') return this.alta(p);

    return { status: 404, cuerpo: { error: { code: 'NOT_FOUND', message: 'no existe' } } };
  };

  /** Sólo las empresas de ESTE correo. Es el filtro que hace el aislamiento. */
  private mias(correo: string): RespuestaApi {
    const tenants = this.membresias
      .filter((m) => m.email === correo)
      .map((m) => {
        const t = this.tenants.find((x) => x.slug === m.slug);
        return {
          tenantId: m.slug,
          slug: m.slug,
          name: t?.name ?? '',
          role: m.role,
          status: m.status,
        };
      });

    return { status: 200, cuerpo: { tenants } };
  }

  private alta(p: PeticionApi): RespuestaApi {
    const cuerpo = (p.cuerpo ?? {}) as { slug?: string; name?: string };
    const slug = String(cuerpo.slug ?? '');
    const name = String(cuerpo.name ?? '');

    if (!slug || !name) {
      return { status: 422, cuerpo: { error: { code: 'VALIDATION', message: 'faltan datos' } } };
    }

    const existente = this.tenants.find((t) => t.slug === slug);
    if (existente) {
      if (existente.owner !== p.correo) {
        return {
          status: 409,
          cuerpo: { error: { code: 'CONFLICT', message: 'Ese slug ya está tomado.' } },
        };
      }
      return { status: 200, cuerpo: { tenantId: slug, created: false } };
    }

    this.tenants.push({ slug, name, owner: p.correo });
    this.membresias.push({ slug, email: p.correo, role: 'owner', status: 'active' });

    return { status: 201, cuerpo: { tenantId: slug, created: true } };
  }
}
