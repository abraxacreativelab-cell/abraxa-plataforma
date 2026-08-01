import { HEADER } from '@abraxa/config';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Quién está entrando, resuelto SIEMPRE server-side.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El correo y la empresa salen de la sesión verificada. Nunca de un header ni
 *  de una cookie que mandó el navegador: ese 403 es lo único que impide que el
 *  cliente A lea los datos del B, y una pantalla que "mientras tanto" confía en
 *  el navegador es exactamente cómo se cuela un agujero de aislamiento a
 *  producción.
 *
 *  El cableado de la sesión es de H2 (§7 de su handoff: el contrato BFF↔API con
 *  `x-user-email`, `x-tenant-slug` y `x-proxy-secret`). Mientras no aterrice,
 *  esto devuelve `null` y la pantalla lo dice con todas sus letras — que es la
 *  respuesta honesta, y la misma que eligió H5 en `(app)/layout.tsx`.
 */
export interface Identidad {
  userEmail: string;
  tenantSlug: string;
}

interface SesionConTenant {
  user?: { email?: string | null; tenantSlug?: string | null } | null;
}

export async function identidadDeLaSesion(): Promise<Identidad | null> {
  try {
    // El cableado de NextAuth YA aterrizó (H18, PR #25). Este archivo anticipaba
    // el cambio en su propio comentario: «cuando H2 configure NextAuth de verdad,
    // esto se cambia por su `authOptions`». Es exactamente lo que ocurre aquí.
    //
    // `authOptions` NO ES OPCIONAL, y ésta es la razón por la que la pantalla
    // decía «falta saber quién eres» con una sesión de Google perfectamente
    // válida ya emitida: `getServerSession()` SIN opciones no ejecuta el callback
    // `session` que vive en ellas, y ese callback es quien pone `tenantSlug`. Sin
    // él la guarda de abajo veía `tenantSlug === undefined` y devolvía `null`,
    // indistinguible de «no hay sesión». Un fallo silencioso: sin error, sin log,
    // y con el invitado ya autenticado mirando una pantalla que le pide entrar.
    //
    // Los imports siguen siendo dinámicos a propósito: mantienen esta carpeta
    // desacoplada del arranque del módulo y no cambian el comportamiento cuando
    // todo está en su sitio.
    const [modulo, opciones] = await Promise.all([
      import('next-auth/next') as unknown as Promise<{
        getServerSession: (o: unknown) => Promise<SesionConTenant | null>;
      }>,
      import('../../../api/auth/opciones'),
    ]);
    const sesion = await modulo.getServerSession(opciones.authOptions);

    const userEmail = sesion?.user?.email;
    const tenantSlug = sesion?.user?.tenantSlug;
    if (!userEmail || !tenantSlug) return null;

    return { userEmail, tenantSlug };
  } catch {
    // Un invitado que todavía no tiene empresa llega aquí con `tenantSlug: null`
    // y sale por la guarda de arriba, no por este catch. Esto cubre lo
    // inesperado —el módulo ausente, una excepción del proveedor— y falla
    // CERRADO, que es lo correcto: sin identidad no se entrevista a nadie.
    return null;
  }
}

/** Las cabeceras del contrato BFF→API para esta identidad. */
export function cabecerasPara(id: Identidad): Record<string, string> {
  const cabeceras: Record<string, string> = {
    'content-type': 'application/json',
    [HEADER.userEmail]: id.userEmail,
    [HEADER.tenantSlug]: id.tenantSlug,
  };

  const secreto = process.env.PROXY_SECRET;
  if (secreto) cabeceras[HEADER.proxySecret] = secreto;

  return cabeceras;
}

export function baseDeLaApi(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3100';
}
