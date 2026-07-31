import { PlatformError, tryPort, type TenancyPort, type TenantContext } from '@abraxa/db';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  De la sesión del navegador al `TenantContext` verificado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Estas pantallas son Server Components: leen la bóveda llamando a
 *  `@abraxa/vault/api` directamente, sin pasar por HTTP.
 *
 *  Eso no es una comodidad, es lo correcto: el salto navegador→API es
 *  justamente donde un `x-user-email` se puede falsificar, y el patrón de
 *  GARDEN que hay que conservar dice que ese header SÓLO lo pone el servidor
 *  desde una sesión verificada. Si el dato nunca sale del servidor, no hay
 *  header que falsificar.
 *
 *  ── Lo que todavía no existe y no es mío ───────────────────────────────────
 *
 *  El contexto sale de `TenancyPort.contextFor()`, que implementa H2. Mientras
 *  H2 no aterrice, `tryPort('tenancy')` devuelve null y estas pantallas
 *  muestran un estado honesto en vez de inventarse un tenant.
 *
 *  Tampoco existe todavía la sesión de next-auth (es del shell de H5) ni una
 *  ruta BFF en `apps/web/app/api/**`, que no está asignada a ningún handoff en
 *  `.ownership.json`. Las dos cosas están anotadas en el PR.
 */

export class BovedaNoDisponible extends Error {
  constructor(
    readonly motivo: string,
    readonly quienFalta: string,
  ) {
    super(motivo);
    this.name = 'BovedaNoDisponible';
  }
}

/**
 * Atajo SÓLO de desarrollo, para poder ver estas pantallas antes de que H2 y
 * H5 aterricen.
 *
 * Fail-closed por diseño: exige `NODE_ENV !== 'production'` **y** que alguien
 * haya puesto la variable a mano. En producción no hay forma de encenderlo,
 * ni por accidente ni por una variable de entorno mal copiada.
 */
function contextoDeDesarrollo(): TenantContext | null {
  if (process.env.NODE_ENV === 'production') return null;

  const tenantId = process.env.VAULT_DEV_TENANT_ID;
  const tenantSlug = process.env.VAULT_DEV_TENANT_SLUG;
  if (!tenantId || !tenantSlug) return null;

  console.warn(
    '[direccion] usando VAULT_DEV_TENANT_ID: contexto de DESARROLLO sin sesión verificada. ' +
      'Esto no existe en producción.',
  );

  return {
    tenantId,
    tenantSlug,
    userEmail: process.env.VAULT_DEV_USER_EMAIL ?? 'dev@localhost',
    role: 'owner',
    areas: { direccion: 'admin' },
  };
}

/**
 * El contexto de quien está viendo la pantalla.
 * Lanza `BovedaNoDisponible` cuando falta una pieza, con el nombre de quién la
 * debe: la pantalla lo enseña tal cual en vez de un error genérico.
 */
export async function contextoActual(): Promise<TenantContext> {
  const dev = contextoDeDesarrollo();
  if (dev) return dev;

  const tenancy = tryPort('tenancy');
  if (!tenancy) {
    throw new BovedaNoDisponible(
      'Todavía no existe el registro de empresas y usuarios, así que no se puede ' +
        'saber de qué negocio son estos datos.',
      'H2 · packages/tenancy',
    );
  }

  const userEmail = await correoDeLaSesion();
  if (!userEmail) {
    throw new BovedaNoDisponible(
      'No hay una sesión iniciada.',
      'H5 · el shell y el inicio de sesión',
    );
  }

  const tenantSlug = await empresaSeleccionada(userEmail, tenancy);
  if (!tenantSlug) {
    throw new BovedaNoDisponible(
      'Tu cuenta todavía no está asociada a una empresa.',
      'H7 · el Ritual de Fundación',
    );
  }

  try {
    return await tenancy.contextFor({ userEmail, tenantSlug });
  } catch (e) {
    if (PlatformError.is(e) && e.code === 'FORBIDDEN') {
      throw new BovedaNoDisponible('No tienes acceso a esta empresa.', '—');
    }
    throw e;
  }
}

/**
 * El correo de la sesión.
 *
 * Cuando H5 monte next-auth, esto pasa a ser `(await getServerSession())?.user?.email`.
 * Hoy devuelve null y la pantalla lo dice. Lo que NO hace es leer un header
 * del navegador: eso convertiría el aislamiento entre clientes en una
 * sugerencia.
 */
async function correoDeLaSesion(): Promise<string | null> {
  return null;
}

async function empresaSeleccionada(userEmail: string, tenancy: TenancyPort): Promise<string | null> {
  return tenancy.primaryTenantSlugFor(userEmail);
}
