import type { TenantContext } from '@abraxa/db/ports';
import { tryPort } from '@abraxa/db';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Quién está entrando al panel. Server-side, verificado, y falla CERRADO.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es el mismo patrón que `(app)/layout.tsx` —el shell ya lo hacía bien y es de
 *  donde se copió— con una sola diferencia: aquí también se devuelve el NOMBRE
 *  de la empresa y el correo, porque el panel los pinta y el shell no.
 *
 *  ── `authOptions` NO es opcional ───────────────────────────────────────────
 *
 *  `getServerSession()` a secas no ejecuta `callbacks.session` —que vive dentro
 *  de las opciones y es quien pone `tenantSlug`— y devuelve una sesión
 *  incompleta SIN error y SIN log. Es exactamente el fallo que tuvo apagado el
 *  Ritual: invitado autenticado, pantalla pidiéndole entrar. El archivo de
 *  identidad lo dice con una advertencia arriba del todo (`api/auth/opciones.ts`).
 *
 *  ── Por qué los imports son dinámicos ──────────────────────────────────────
 *
 *  Para que un fallo del módulo de identidad no tumbe el panel entero. Sin
 *  sesión legible, esto devuelve `null` y la pantalla enseña el panel de
 *  invitado —navegable, con sus cuatro áreas y su llamada a empezar el Ritual—
 *  en vez de un 500. Un producto que se cae porque no puede saludarte por tu
 *  nombre está peor hecho que uno que te saluda de usted.
 *
 *  ── Lo que NO se hace, y es lo único que impide una fuga ───────────────────
 *
 *  No se lee el correo ni el slug de una cabecera o de una cookie que mandó el
 *  navegador. El `TenantContext` sale SIEMPRE de `TenancyPort.contextFor()`,
 *  que revalida la membresía contra `app.memberships` y lanza si no la hay. Ese
 *  403 es lo único que impide que el cliente A vea el panel del B.
 */

/** La sesión, tal como la deja `callbacks.session` de `api/auth/opciones.ts`. */
interface SesionDelPanel {
  user?: {
    email?: string | null;
    tenantSlug?: string | null;
    tenantName?: string | null;
    motivoSinEmpresa?: string | null;
  } | null;
}

export interface QuienEntra {
  userEmail: string;
  tenantSlug: string;
  /** El nombre real de la empresa, si la sesión lo trae. */
  tenantName: string | null;
  /** El contexto verificado. `null` si el módulo de empresa no contestó. */
  ctx: TenantContext | null;
}

/**
 * La sesión cruda. Se expone aparte del contexto porque el panel puede pintar
 * algo útil con sólo el correo: quien tiene sesión pero todavía no tiene
 * empresa merece una pantalla que se lo diga, no una que lo mande a entrar otra
 * vez a la cuenta con la que ya entró.
 */
export async function sesionDelPanel(): Promise<SesionDelPanel | null> {
  try {
    const [{ getServerSession }, { authOptions }] = await Promise.all([
      import('next-auth/next') as unknown as Promise<{
        getServerSession: (o: unknown) => Promise<SesionDelPanel | null>;
      }>,
      // `authOptions` NO es opcional: sin ellas el callback que pone
      // `tenantSlug` no corre y la sesión vuelve incompleta sin avisar.
      import('../../../api/auth/opciones'),
    ]);

    return await getServerSession(authOptions);
  } catch {
    // Falla CERRADO. Sin identidad legible no se pide el dato de nadie.
    return null;
  }
}

/**
 * Quién entra, con su empresa ya verificada.
 *
 * Devuelve `null` en los dos casos en que no hay a quién servirle datos: sin
 * sesión y sin empresa. El panel los distingue con `sesionDelPanel()` para
 * poder decir cuál de los dos es — no son lo mismo y no se arreglan igual.
 */
export async function quienEntra(): Promise<QuienEntra | null> {
  const sesion = await sesionDelPanel();

  const userEmail = sesion?.user?.email;
  const tenantSlug = sesion?.user?.tenantSlug;
  if (!userEmail || !tenantSlug) return null;

  return {
    userEmail,
    tenantSlug,
    tenantName: sesion?.user?.tenantName ?? null,
    ctx: await contextoDe(userEmail, tenantSlug),
  };
}

/**
 * El `TenantContext`, o `null`.
 *
 * Va aparte y tolera el fallo a propósito: que el módulo de empresa no esté
 * registrado —o que tire— no puede impedir que alguien con sesión vea su
 * panel. Lo que sí impide es que se le sirva un solo dato de dominio: sin
 * contexto no se llama a ningún port, y por eso el panel cae al catálogo de
 * arranque, que no consulta la base de nadie.
 */
async function contextoDe(userEmail: string, tenantSlug: string): Promise<TenantContext | null> {
  try {
    // Un port se registra como EFECTO de importar el paquete que lo publica, y
    // `apps/web` no importa `@abraxa/tenancy` en ninguna parte —lo hace
    // `apps/api`, que es otro proceso—. Así que `tryPort` devolvía `null`
    // siempre, este archivo se rendía antes de preguntar nada, y el panel salía
    // genérico para todo el mundo, incluido quien tenía el Ritual al 100%.
    //
    // Se importa a demanda: si nadie lo registró, se registra aquí.
    let tenancy = tryPort('tenancy');
    if (!tenancy) {
      await import('@abraxa/tenancy');
      tenancy = tryPort('tenancy');
    }
    if (!tenancy) return null;
    return await tenancy.contextFor({ userEmail, tenantSlug });
  } catch {
    return null;
  }
}
