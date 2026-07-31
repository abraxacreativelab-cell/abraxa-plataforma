import { notFound } from 'next/navigation';
import { tryPort } from '@abraxa/db';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Layout del route group `(admin)` — el panel de agencia. Dueño: H14.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Este archivo es **la puerta**, no la decoración. Todo lo que cuelgue de
 *  `(admin)/**` hereda esta verificación sin tener que acordarse de nada, que
 *  es justo lo contrario de esconder botones: una pantalla que se protege
 *  ocultando su enlace está abierta para cualquiera que teclee la URL.
 *
 *  ── Fail-closed, y el orden importa ────────────────────────────────────────
 *
 *  Cuatro puertas, todas cerradas por defecto. Se cruzan en este orden porque
 *  cada una es más cara que la anterior:
 *
 *    1. ¿Está configurado el panel?  Sin `CORE_ADMIN_EMAILS` no entra NADIE —
 *       ni quien escribió esto. Una variable que se pierde en un deploy no
 *       puede abrir el panel de administración. Es el patrón de
 *       `GARDEN/garden-os/app/api/auth/check/route.ts:17-18`.
 *    2. ¿Hay una sesión verificada?  El correo sale del servidor. Jamás de una
 *       cabecera del navegador: eso convertiría el candado en una sugerencia.
 *    3. ¿Ese correo es de la plataforma?  La lista, comparada normalizada.
 *    4. ¿H2 dice que la cuenta puede entrar?  `canSignIn` es fail-closed por
 *       contrato: cualquier error de red devuelve `false`, jamás `true`.
 *
 *  ── Lo que este archivo NO inventa ─────────────────────────────────────────
 *
 *  No hay un RBAC nuevo. `MembershipRole` de H2 —`owner`, `admin`, `member`,
 *  `viewer`— describe qué puede hacer alguien DENTRO de una empresa, y ninguno
 *  de esos roles significa nada aquí: **el dueño de una panadería tiene rol
 *  `owner` y no abre el panel de agencia.** Ser administrador de la plataforma
 *  es una condición de otro plano, y su única fuente es `CORE_ADMIN_EMAILS`.
 *  Ese es el escenario 4 de la prueba de acceso, y es el que da nombre al
 *  carril.
 *
 *  ── Y lo que tampoco hace: consultar varias empresas ───────────────────────
 *
 *  Un panel de agencia querría leer todos los tenants a la vez, y todo el resto
 *  del sistema está construido sobre lo contrario: `tenantDb(ctx)` encierra
 *  cada consulta en UNA empresa, y ésa es la única razón por la que el
 *  aislamiento se sostiene. Aquí no se abre esa puerta, ni con el cliente crudo
 *  ni con `adminDb()`. La consulta cruzada que el panel necesita está pedida
 *  como handoff en el PR, para que la escriba quien es dueño del aislamiento y
 *  con su prueba adversarial. Ver `docs/handoffs/H14-admin.md` §6.
 */

/**
 * Sin esto, Next podría resolver la decisión de acceso en el build y servir el
 * resultado cacheado a todo el mundo. Un candado que se evalúa una sola vez no
 * es un candado. `dynamic` se hereda por el subárbol; la página lo repite de
 * todos modos, porque en una frontera de seguridad la redundancia explícita
 * vale más que la elegancia.
 */
export const dynamic = 'force-dynamic';

/** Por qué no entraste. Se registra en el servidor; al navegador sólo va un 404. */
type Denegacion =
  | 'panel_sin_configurar'
  | 'sin_sesion'
  | 'no_es_admin_de_plataforma'
  | 'tenancy_no_disponible'
  | 'cuenta_sin_acceso';

const PORQUE: Record<Denegacion, string> = {
  panel_sin_configurar:
    'CORE_ADMIN_EMAILS no está configurada, o está vacía. Fail-closed: no entra nadie.',
  sin_sesion: 'No hay una sesión verificada en el servidor.',
  no_es_admin_de_plataforma:
    'El correo tiene sesión pero no está en CORE_ADMIN_EMAILS. Ser dueño de una empresa no es ser administrador de la plataforma.',
  tenancy_no_disponible:
    'TenancyPort (H2) no está registrado, así que no se puede verificar la cuenta. Fail-closed.',
  cuenta_sin_acceso: 'H2 respondió que esta cuenta no puede iniciar sesión.',
};

type Acceso = { permitido: true; correo: string } | { permitido: false; motivo: Denegacion };

/**
 * Los correos del equipo de ABRAXA, normalizados.
 *
 * El `filter` no es cosmético. `''.split(',')` devuelve `['']`, así que una
 * variable vacía —o una que quedó en `" , , "` después de borrar a alguien—
 * produciría un conjunto con la cadena vacía adentro; y si el correo de la
 * sesión llegara también vacío, esa comparación daría verdadera y la puerta se
 * abriría sola. Se tapa por los dos lados a propósito: aquí se filtran los
 * vacíos, y en `resolverAcceso` se exige que el correo tenga contenido antes de
 * comparar nada.
 */
function correosDePlataforma(crudo: string | undefined): Set<string> {
  return new Set(
    (crudo ?? '')
      .split(',')
      .map((correo) => correo.trim().toLowerCase())
      .filter((correo) => correo.length > 0),
  );
}

/**
 * El correo de quien está viendo la pantalla, resuelto en el servidor.
 *
 * Cuando H18 monte NextAuth esto pasa a ser
 * `(await getServerSession(authOptions))?.user?.email ?? null`, y este archivo
 * no cambia en nada más. Hoy `packages/auth` no existe y `apps/web/app/api/**`
 * es de H18, así que en producción devuelve `null` — y `null` significa que no
 * entra nadie, que es la respuesta honesta mientras no haya sesión que
 * verificar.
 */
async function correoDeLaSesion(): Promise<string | null> {
  return correoDeDesarrollo();
}

/**
 * Atajo SÓLO de desarrollo, calcado del que H4 usa en la bóveda
 * (`(app)/direccion/_lib/session.ts:46`). Exige `NODE_ENV !== 'production'`
 * **y** que alguien haya puesto la variable a mano: en producción no hay forma
 * de encenderlo, ni por accidente ni por una variable mal copiada en un deploy.
 *
 * No se salta el resto de las puertas — el correo que entrega todavía tiene que
 * estar en `CORE_ADMIN_EMAILS` y pasar por H2. Es una sesión de mentira, no un
 * pase libre.
 */
function correoDeDesarrollo(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const correo = process.env.ADMIN_DEV_USER_EMAIL?.trim();
  if (!correo) return null;

  console.warn(
    '[admin] usando ADMIN_DEV_USER_EMAIL: sesión de DESARROLLO sin verificar. No existe en producción.',
  );
  return correo;
}

/** La decisión completa. Devuelve en vez de lanzar: quien la usa decide qué hacer. */
async function resolverAcceso(): Promise<Acceso> {
  const permitidos = correosDePlataforma(process.env.CORE_ADMIN_EMAILS);
  if (permitidos.size === 0) return { permitido: false, motivo: 'panel_sin_configurar' };

  const correo = (await correoDeLaSesion())?.trim() ?? '';
  if (correo.length === 0) return { permitido: false, motivo: 'sin_sesion' };
  if (!permitidos.has(correo.toLowerCase())) {
    return { permitido: false, motivo: 'no_es_admin_de_plataforma' };
  }

  // La autoridad sobre las cuentas es H2, no una lista en el entorno: un correo
  // que sigue en CORE_ADMIN_EMAILS pero cuya cuenta se dio de baja no entra.
  const tenancy = tryPort('tenancy');
  if (!tenancy) return { permitido: false, motivo: 'tenancy_no_disponible' };
  if (!(await tenancy.canSignIn(correo))) {
    return { permitido: false, motivo: 'cuenta_sin_acceso' };
  }

  return { permitido: true, correo };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const acceso = await resolverAcceso();

  if (!acceso.permitido) {
    console.warn(`[admin] acceso denegado · ${acceso.motivo} · ${PORQUE[acceso.motivo]}`);
    // 404 y no 403, a propósito: a quien no es del equipo no se le confirma
    // siquiera que el panel existe.
    notFound();
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">
          <div className="min-w-0">
            <p className="eyebrow-primary">ABRAXA · interno</p>
            <p className="truncate text-lg font-semibold tracking-tight">Panel de agencia</p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden truncate text-sm text-muted-foreground sm:inline">
              {acceso.correo}
            </span>
            <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              sólo equipo ABRAXA
            </span>
          </div>
        </div>
      </header>

      {/*
        Se dice en la pantalla y no sólo en un comentario: hoy este panel LEE.
        La suplantación de un cliente —auditada, visible dentro de su cuenta y
        con caducidad de 30 minutos— es la función peligrosa del carril y
        todavía no existe. Anunciar una capacidad que no está es la misma
        mentira que enseñar un cero falso.
      */}
      <p className="border-b border-border bg-muted/30 px-6 py-2 text-center text-xs text-muted-foreground">
        Panel de sólo lectura. La suplantación de clientes aún no existe: cuando exista, quedará
        auditada, se verá dentro de la cuenta del cliente y caducará sola a los 30 minutos.
      </p>

      <main id="contenido" className="mx-auto max-w-6xl px-6 py-10">
        {children}
      </main>
    </div>
  );
}
