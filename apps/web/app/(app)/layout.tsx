import type { AreaSummary, TenantContext } from '@abraxa/db/ports';
import { tryPort } from '@abraxa/db';
import {
  type AreasResult,
  type SenalesDelRitual,
  AppShell,
  areasDeArranque,
  requisitosDeArranque,
  resolveAreas,
} from '@abraxa/ui';
import { fotoDelPanel } from './panel/_lib/datos';

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

  /**
   * ── Lo que arregla el hallazgo 4 del ensayo ──────────────────────────────
   *
   * «EL PANEL MIENTE SOBRE LO QUE FALTA: con el Ritual COMPLETO sigue diciendo
   *  "Se abre cuando tu agente termine contigo El bautizo".»
   *
   * Las dos funciones de abajo aceptan `senales` desde el primer día. Aquí se
   * las llamaba SIN nada, o sea "el Ritual no ha empezado", para todo el mundo
   * —incluido quien ya lo había terminado. Una línea de diferencia entre un
   * shell que acompaña el avance y uno que se lo niega.
   *
   * `fotoDelPanel()` va memoizada por petición con `cache()` de React, así que
   * el layout y `/panel` leen LA MISMA foto sin un segundo viaje a la API. Que
   * sea la misma no es una optimización: es lo que impide que la barra lateral
   * diga que Ventas está abierta y el mosaico diga que no.
   */
  const foto = await fotoDelPanel();
  const senales = foto.senales;

  const { source, areas, failure } = await cargarAreas(ctx, senales);

  return (
    <AppShell
      areas={areas}
      failure={failure ?? null}
      requirements={requisitosDeArranque(senales)}
      brand={null}
      // El NOMBRE de la empresa, no su slug. Antes se pasaba `ctx.tenantSlug` y
      // la barra superior anunciaba «taqueria-regia-mg34yjj6» como el nombre del
      // negocio de alguien. El nombre viaja en la sesión (`callbacks.session` de
      // `api/auth/opciones.ts` lo copia del token), así que no cuesta una
      // consulta.
      businessName={foto.tenantName}
      // El agente ya bautizado, en la barra superior y en toda la interfaz. Es
      // el dato que hace que el producto se sienta suyo desde la primera
      // pantalla, y estaba en `null` fijo teniéndolo a mano.
      agentName={foto.ritual?.agente ?? null}
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
 *
 * Y desde hoy el respaldo recibe las SEÑALES del Ritual, así que se abre solo
 * conforme el emprendedor avanza — que es exactamente para lo que se escribió.
 */
async function cargarAreas(
  ctx: TenantContext | null,
  senales: SenalesDelRitual | null,
): Promise<AreasResult> {
  const areas = tryPort('areas');
  const resuelto = await resolveAreas(areas && ctx ? () => areas.listAreas(ctx) : null, senales);

  // Sin port, sin sesión, o con el port devolviendo vacío: el catálogo de
  // arranque. Un shell sin navegación no se puede recorrer, y un invitado que
  // no ve las áreas no tiene por qué querer desbloquearlas.
  //
  // Lo de "devolviendo vacío" no es hipotético: consultado en producción el
  // 2026-08-01, `app.tenant_areas` está VACÍA para las tres empresas, incluida
  // una con el Ritual al 100%.
  if (resuelto.source !== 'port' || resuelto.areas.length === 0) {
    return { source: 'arranque', areas: areasDeArranque(senales) satisfies AreaSummary[] };
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
