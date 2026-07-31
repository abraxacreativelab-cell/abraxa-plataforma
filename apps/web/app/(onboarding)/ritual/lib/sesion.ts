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
    // Import dinámico: si H2 todavía no configuró NextAuth, no queremos que la
    // ruta reviente al cargar el módulo — queremos que diga que falta.
    // El cast pasa por `unknown` porque `getServerSession` de NextAuth está
    // sobrecargado y su firma real no se solapa con la mínima que aquí hace
    // falta. Cuando H2 configure NextAuth de verdad, esto se cambia por su
    // `authOptions` y el cast desaparece.
    const modulo = (await import('next-auth/next')) as unknown as {
      getServerSession: () => Promise<SesionConTenant | null>;
    };
    const sesion = await modulo.getServerSession();

    const userEmail = sesion?.user?.email;
    const tenantSlug = sesion?.user?.tenantSlug;
    if (!userEmail || !tenantSlug) return null;

    return { userEmail, tenantSlug };
  } catch {
    // TODO(H2): en cuanto exista el handler de NextAuth y `primaryTenantSlugFor`,
    // esto empieza a devolver identidad sin que cambie nada más de esta carpeta.
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
