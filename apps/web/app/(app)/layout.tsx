import { cookies } from 'next/headers';
import type { AreaSummary, TenantContext } from '@abraxa/db/ports';
import { tryPort } from '@abraxa/db';
import { type AreasResult, AppShell, MOCK_REQUIREMENTS, resolveAreas } from '@abraxa/ui';

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
  const { source, areas, failure } = await cargarAreas();
  const enDesarrollo = process.env.NODE_ENV !== 'production';

  return (
    <AppShell
      areas={areas}
      failure={failure ?? null}
      requirements={MOCK_REQUIREMENTS}
      brand={null}
      businessName={null}
      agentName={null}
      mockTools={source === 'mock'}
      notice={source === 'mock' && enDesarrollo ? 'navegación de prueba' : null}
    >
      {children}
    </AppShell>
  );
}

/**
 * Regla 5 del contrato: se programa contra `AreasPort`, no contra H11.
 *
 * En cuanto H11 registre su implementación y H2 la sesión, esto empieza a
 * servir datos reales sin que cambie una línea del shell. Mientras tanto
 * devuelve el mock de las cuatro áreas de v1 — y lo anuncia en la barra
 * superior, para que nadie pierda una tarde depurando datos que nunca fueron
 * reales.
 */
async function cargarAreas(): Promise<AreasResult> {
  const forzado = estadoForzado();
  if (forzado) return forzado;

  const areas = tryPort('areas');
  const ctx = await contextoVerificado();

  return resolveAreas(areas && ctx ? () => areas.listAreas(ctx) : null);
}

/**
 * Interruptor de estados, **sólo en desarrollo**.
 *
 * Con la cookie `abraxa_shell_demo` puesta en `error` o `vacio`, el shell pinta
 * ese estado. Sirve para dos cosas: verificar el criterio 6 del handoff con
 * evidencia real, y que cualquiera de los 13 handoffs pueda ver cómo se
 * comporta su pantalla cuando la carga falla, sin tener que romper su backend
 * a propósito.
 *
 * En producción esta función devuelve `null` antes de tocar `cookies()`, así
 * que el layout no se vuelve dinámico por esto.
 */
function estadoForzado(): AreasResult | null {
  if (process.env.NODE_ENV === 'production') return null;

  const demo = cookies().get('abraxa_shell_demo')?.value;
  if (demo === 'error') {
    return { source: 'error', areas: null, failure: { kind: 'servidor', status: 500 } };
  }
  if (demo === 'vacio') {
    return { source: 'port', areas: [] as AreaSummary[] };
  }
  return null;
}

/**
 * El contexto del tenant, construido SIEMPRE server-side desde una sesión
 * verificada — nunca desde un header que mandó el navegador.
 *
 * Lo entrega `TenancyPort.contextFor` (H2), y el punto de cableado con la
 * sesión es este archivo. Hasta que H2 aterrice no hay sesión que verificar, y
 * devolver `null` es la respuesta honesta: se deja sin implementar a propósito
 * porque ese 403 es lo único que impide que el cliente A lea los datos del B, y
 * eso no es de H5.
 */
async function contextoVerificado(): Promise<TenantContext | null> {
  const tenancy = tryPort('tenancy');
  if (!tenancy) return null;

  // TODO(H2): leer la sesión y llamar tenancy.contextFor({ userEmail, tenantSlug }).
  return null;
}
