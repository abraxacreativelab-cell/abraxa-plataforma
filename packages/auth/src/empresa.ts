/**
 * ════════════════════════════════════════════════════════════════════════════
 *  De un correo verificado por Google a una empresa propia. Una sola vez.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es lo que ocurre entre que el invitado aprieta "Continuar con Google" y que
 *  ve el Ritual: se le busca empresa y, si no tiene, se le crea una — con su
 *  membresía, su plan y sus permisos — reusando `provision()` de H2.
 *
 *  ── Lo que este módulo NO hace, a propósito ────────────────────────────────
 *
 *  No habla con Postgres, no importa `@abraxa/tenancy` y no conoce una sola
 *  cabecera. Recibe un `Transporte` y lo llama. Tres razones:
 *
 *   1. Corre dentro de NextAuth, en el proceso del BFF. Importar el paquete de
 *      tenancy metería `adminDb()`, `pg` y el registro de ports en el bundle
 *      de Next para acabar hablando con la misma base por otro camino.
 *   2. El alta ya existe y está probada del otro lado. `POST /tenants` toma el
 *      dueño de la sesión verificada e ignora el `ownerEmail` del cuerpo
 *      (packages/tenancy/src/routes/index.ts, decisión 2). Reescribirla aquí
 *      sería el quinto `contextoDe` de este repo.
 *   3. Sin transporte inyectado, probar el aislamiento entre dos invitados
 *      exigiría una base de datos. Con él, `aislamiento.test.ts` levanta una
 *      API falsa con las MISMAS reglas que la de verdad y comprueba en
 *      milisegundos lo único que no puede fallar.
 *
 *  ── El orden: listar, y sólo entonces crear ────────────────────────────────
 *
 *  Primero `GET /tenants/mine`. Quien ya tiene empresa —porque volvió, o
 *  porque alguien lo invitó a la suya— entra a la que ya es suya y no estrena
 *  una vacía cada vez.
 *
 *  Si listar FALLA, se crea de todos modos. Parece temerario y es justo lo
 *  contrario: el slug es determinista por correo, así que crear cuando ya
 *  existía devuelve `created: false` y **la misma empresa**. Rendirse ahí
 *  dejaría al invitado sin nada por un 500 pasajero; insistir no puede
 *  duplicar nada.
 */
import { nombreDeEmpresa, slugAlternativo, slugDeCorreo } from './slug';

// ─── El contrato con la API ───────────────────────────────────────────────

export interface RespuestaApi {
  readonly status: number;
  readonly cuerpo: unknown;
}

export interface PeticionApi {
  readonly ruta: string;
  readonly metodo: 'GET' | 'POST';
  /** El correo de la sesión verificada. El transporte lo convierte en cabecera. */
  readonly correo: string;
  readonly cuerpo?: unknown;
}

/**
 * Cómo se le habla a `apps/api`. Lo implementa el BFF —que es el único que
 * puede poner las cabeceras de identidad— y lo sustituye la prueba.
 */
export type Transporte = (peticion: PeticionApi) => Promise<RespuestaApi>;

export interface EmpresaResumen {
  slug: string;
  name: string;
  role: string;
  status: string;
}

// ─── El resultado ─────────────────────────────────────────────────────────

export type ResultadoEmpresa =
  | { estado: 'lista'; slug: string; nombre: string; creada: boolean }
  | { estado: 'sin-empresa'; motivo: string };

/**
 * Cuántos slugs alternativos se prueban antes de rendirse.
 *
 * Tres. Un cuarto intento no arregla nada que no arreglaran los tres primeros
 * y sí retrasa el mensaje honesto delante de alguien que está esperando.
 */
const MAX_INTENTOS = 3;

/**
 * Qué empresa le toca a este correo. La crea si no tiene ninguna.
 *
 * Nunca lanza: un fallo devuelve `sin-empresa` con el motivo escrito. Que el
 * alta falle NO puede impedir entrar — quien entra sin empresa ve una pantalla
 * que lo dice, y eso es infinitamente mejor que un 500 en el callback de
 * Google, que se ve como "ABRAXA no funciona".
 */
export async function empresaDe(
  correo: string,
  nombreDeGoogle: string | null | undefined,
  transporte: Transporte,
): Promise<ResultadoEmpresa> {
  const email = correo.trim().toLowerCase();
  if (!email) return { estado: 'sin-empresa', motivo: 'La sesión no trae correo.' };

  const yaTiene = await empresaExistente(email, transporte);
  if (yaTiene) {
    return { estado: 'lista', slug: yaTiene.slug, nombre: yaTiene.name, creada: false };
  }

  return crearEmpresa(email, nombreDeGoogle, transporte);
}

// ─── Buscar ───────────────────────────────────────────────────────────────

/**
 * La empresa que le toca a alguien que ya pertenece a alguna.
 *
 * Con varias, se prefiere la que es SUYA: `owner` antes que `admin`, y a
 * igualdad de rol el slug menor. Elegir "la primera que devolvió la API" haría
 * que la misma persona aterrizara un día en una empresa y al siguiente en otra
 * según cómo ordenara Postgres esa consulta.
 *
 * `null` significa las dos cosas —no tiene, o no se pudo averiguar— y las dos
 * llevan al mismo sitio: intentar crearla, que es idempotente.
 */
async function empresaExistente(
  correo: string,
  transporte: Transporte,
): Promise<EmpresaResumen | null> {
  let r: RespuestaApi;
  try {
    r = await transporte({ ruta: '/tenants/mine', metodo: 'GET', correo });
  } catch {
    return null;
  }

  if (r.status !== 200) return null;

  const cuerpo = r.cuerpo as { tenants?: unknown } | null | undefined;
  const lista = cuerpo?.tenants;
  const crudas: unknown[] = Array.isArray(lista) ? lista : [];

  const activas = crudas
    .filter((t): t is EmpresaResumen => {
      const e = t as Partial<EmpresaResumen> | null;
      return typeof e?.slug === 'string' && e.slug.length > 0 && e.status === 'active';
    })
    .sort((a, b) => rango(a.role) - rango(b.role) || a.slug.localeCompare(b.slug));

  return activas[0] ?? null;
}

const ORDEN_ROL: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
const rango = (rol: string): number => ORDEN_ROL[rol] ?? 9;

// ─── Crear ────────────────────────────────────────────────────────────────

/**
 * El alta, con reintento sólo ante CONFLICT.
 *
 * CONFLICT (409) quiere decir exactamente una cosa: ese slug existe y es de
 * OTRA persona. Es el único error que se puede resolver reintentando, y se
 * resuelve cambiando el slug, no repitiendo el mismo. Cualquier otro código se
 * devuelve tal cual: reintentar un 401 tres veces sólo hace esperar de más a
 * alguien a quien ya hay que darle una explicación.
 */
async function crearEmpresa(
  correo: string,
  nombreDeGoogle: string | null | undefined,
  transporte: Transporte,
): Promise<ResultadoEmpresa> {
  const nombre = nombreDeEmpresa(correo, nombreDeGoogle);
  let ultimoMotivo = 'La API no respondió al alta de la empresa.';

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const slug = intento === 1 ? slugDeCorreo(correo) : slugAlternativo(correo, intento);

    let r: RespuestaApi;
    try {
      r = await transporte({
        ruta: '/tenants',
        metodo: 'POST',
        correo,
        cuerpo: { slug, name: nombre },
      });
    } catch (e) {
      return { estado: 'sin-empresa', motivo: `No se pudo llamar a la API: ${String(e)}` };
    }

    if (r.status === 200 || r.status === 201) {
      return { estado: 'lista', slug, nombre, creada: r.status === 201 };
    }

    ultimoMotivo = motivoDe(r);
    if (r.status !== 409) return { estado: 'sin-empresa', motivo: ultimoMotivo };
  }

  return {
    estado: 'sin-empresa',
    motivo: `${ultimoMotivo} (se probaron ${MAX_INTENTOS} slugs distintos)`,
  };
}

/** El mensaje de un `PlatformError`, o algo honesto si la API no lo mandó. */
function motivoDe(r: RespuestaApi): string {
  const cuerpo = r.cuerpo as { error?: { message?: unknown } } | null;
  const mensaje = cuerpo?.error?.message;
  return typeof mensaje === 'string' && mensaje.length > 0
    ? `${mensaje} (HTTP ${r.status})`
    : `La API respondió ${r.status} al dar de alta la empresa.`;
}
