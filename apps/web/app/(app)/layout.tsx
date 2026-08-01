import type { AreaSummary, TenantContext } from '@abraxa/db/ports';
import { tryPort } from '@abraxa/db';
import {
  type AreasResult,
  AppShell,
  areasDeArranque,
  requisitosDeArranque,
  resolveAreas,
} from '@abraxa/ui';

/**
 * Layout del route group `(app)` — **el shell del producto**. Dueño: H5.
 *
 * Aquí cuelgan sus pantallas los otros handoffs: `bandeja/` es de H6, `tareas/`
 * de H9, `direccion/` de H4, `mapa/` de H11… Cada uno escribe sólo su carpeta y
 * hereda el shell, la navegación por áreas y el acento contextual sin tocar
 * este archivo ni coordinarse con nadie.
 *
 * Es un componente de SERVIDOR a propósito: la navegación se resuelve antes de
 * pintar, así que no hay un parpadeo de barra vacía en cada carga.
 */
export default async function GroupLayout({ children }: { children: React.ReactNode }) {
  const ctx = await contextoVerificado();
  const { source, areas, failure } = await cargarAreas(ctx);

  return (
    <AppShell
      areas={areas}
      failure={failure ?? null}
      requirements={requisitosDeArranque()}
      brand={null}
      businessName={ctx?.tenantSlug ?? null}
      agentName={null}
      fallbackTools={source === 'arranque'}
      notice={null}
    >
      {children}
    </AppShell>
  );
}

/**
 * Regla 5 del contrato: se programa contra `AreasPort`, no contra H11.
 *
 * Si H11 registró su implementación y hay sesión, manda ella. Si no, se cae al
 * CATÁLOGO DE ARRANQUE —las áreas reales de v1, con su motivo de cierre— en vez
 * de a una barra vacía.
 *
 * Ese respaldo no es un mock: es lo que hace que el invitado vea desde el primer
 * minuto qué áreas existen y qué le falta para abrir cada una. Las bloqueadas
 * son el gancho, no una disculpa.
 */
async function cargarAreas(ctx: TenantContext | null): Promise<AreasResult> {
  const areas = tryPort('areas');
  const resuelto = await resolveAreas(areas && ctx ? () => areas.listAreas(ctx) : null);

  // Sin port, sin sesión, o con el port devolviendo vacío: el catálogo de
  // arranque. Un shell sin navegación no se puede recorrer, y un invitado que
  // no ve las áreas no tiene por qué querer desbloquearlas.
  if (resuelto.source !== 'port' || resuelto.areas.length === 0) {
    return { source: 'arranque', areas: areasDeArranque() satisfies AreaSummary[] };
  }
  return resuelto;
}

/**
 * El contexto del tenant, construido SIEMPRE server-side desde una sesión
 * verificada — nunca desde un header que mandó el navegador.
 *
 * Hasta el 2026-08-01 esto devolvía `null` con un `TODO(H2)`, y era la respuesta
 * honesta: no había sesión que verificar. Ya la hay (H18, PR #25), así que aquí
 * se cablea.
 *
 * `authOptions` NO ES OPCIONAL. `getServerSession()` sin ellas no ejecuta el
 * callback `session` —que vive dentro y es quien pone `tenantSlug`— y devuelve
 * una sesión incompleta SIN error y SIN log. Es exactamente el fallo silencioso
 * que tuvo el Ritual: invitado autenticado, pantalla pidiéndole entrar.
 *
 * Los imports son dinámicos para que un fallo del módulo de sesión no tumbe el
 * shell entero: sin identidad se cae al catálogo de arranque, que es navegable.
 */
async function contextoVerificado(): Promise<TenantContext | null> {
  try {
    const tenancy = tryPort('tenancy');
    if (!tenancy) return null;

    const [{ getServerSession }, { authOptions }] = await Promise.all([
      import('next-auth/next') as unknown as Promise<{
        getServerSession: (o: unknown) => Promise<{
          user?: { email?: string | null; tenantSlug?: string | null } | null;
        } | null>;
      }>,
      import('../api/auth/opciones'),
    ]);

    const sesion = await getServerSession(authOptions);
    const userEmail = sesion?.user?.email;
    const tenantSlug = sesion?.user?.tenantSlug;
    if (!userEmail || !tenantSlug) return null;

    return await tenancy.contextFor({ userEmail, tenantSlug });
  } catch {
    // Falla CERRADO: sin contexto verificado no se piden áreas de nadie. El
    // shell sigue navegable con el catálogo de arranque.
    return null;
  }
}
