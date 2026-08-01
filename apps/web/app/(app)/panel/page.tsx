import type { Metadata } from 'next';
import type { AreaSummary } from '@abraxa/db/ports';
import { tryPort } from '@abraxa/db';
import { PanelDeInicio, areasDeArranque, requisitosDeArranque, resolveAreas } from '@abraxa/ui';
import { fotoDelPanel } from './_lib/datos';

export const metadata: Metadata = { title: 'Tu panel' };

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `/panel` — la primera pantalla del producto
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── El defecto que esto arregla (hallazgo 2 del ensayo) ────────────────────
 *
 *  «/panel ES 404 Y ES EL PRIMER RENGLÓN DEL MENÚ. La barra lateral pinta "Tu
 *   panel" con href="/panel" y esa ruta no existe.»
 *
 *  Literal: `ENLACE_AL_PANEL` en `app-shell.tsx` apunta a `/panel`, el logotipo
 *  de la barra superior también, y la carpeta no existía. Cada persona con
 *  sesión veía un enlace muerto arriba de todo y otro en el logotipo — los dos
 *  sitios a los que se va cuando uno se pierde.
 *
 *  ── Por qué `/panel` y no `(app)/page.tsx` ─────────────────────────────────
 *
 *  Porque `(app)/page.tsx` NO PUEDE EXISTIR. `(public)/page.tsx` ya resuelve a
 *  `/`, y dos grupos de ruta que resuelven al MISMO path hacen que Next 14 falle
 *  con «You cannot have two parallel pages that resolve to the same path». El
 *  mapa de propiedad me lo había concedido y lo devolví por eso: habría muerto
 *  en `npm run build`, DESPUÉS del gate, que es donde más caro sale.
 *
 *  ── Componente de SERVIDOR ─────────────────────────────────────────────────
 *
 *  El avance del Ritual llega ya resuelto en el HTML. Quien vuelve al día
 *  siguiente abre su panel y lee su propio avance de inmediato, sin un parpadeo
 *  de tarjetas vacías. La misma decisión que tomó H7 en `/ritual`, por la misma
 *  razón.
 */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const foto = await fotoDelPanel();
  const areas = await cargarAreas(foto.senales);

  return (
    <PanelDeInicio
      // El nombre REAL de la empresa, de la sesión. Si no lo hay, el componente
      // dice «Tu negocio», que es honesto. Lo que no se hace nunca es enseñar el
      // slug: `taqueria-regia-mg34yjj6` no es el nombre de la empresa de nadie.
      nombreDelNegocio={foto.tenantName}
      correo={foto.userEmail}
      ritual={foto.ritual}
      pasos={foto.pasos}
      ritualNoDisponible={foto.ritualNoDisponible}
      areas={areas}
      // Las MISMAS señales que abren las áreas alimentan la frase de qué falta.
      // Salir de dos sitios distintos es exactamente cómo un panel acaba
      // enseñando un área abierta con el letrero de cómo abrirla.
      requisitos={requisitosDeArranque(foto.senales)}
      tenantSlug={foto.tenantSlug}
      brand={null}
    />
  );
}

/**
 * Las áreas del negocio.
 *
 * Regla 5 del contrato: se programa contra `AreasPort`, no contra H11. Si H11
 * registró su implementación y hay contexto verificado, manda ella.
 *
 * ── Por qué el respaldo importa HOY y no es un adorno ──────────────────────
 *
 * Consultado en producción el 2026-08-01: `app.tenant_areas` está VACÍA para
 * las tres empresas, incluida una con el Ritual al 100%. El blueprint sí se
 * escribe —`app.onboarding_blueprints` tiene su fila— pero nunca se proyecta a
 * la tabla que lee el panel (hallazgo 3 del ensayo; la proyección es de H11 y
 * no se toca desde aquí).
 *
 * O sea que hoy `listAreas()` devuelve vacío para TODO el mundo. Sin este
 * respaldo, el emprendedor que terminó su Ritual completo abriría su panel y
 * encontraría cero áreas. Con él encuentra las cuatro de su giro, con Ventas ya
 * abierta por haber bautizado a su agente, y las otras tres con su promesa y su
 * motivo. El día que H11 proyecte, esto deja de usarse solo.
 */
async function cargarAreas(
  senales: Awaited<ReturnType<typeof fotoDelPanel>>['senales'],
): Promise<AreaSummary[]> {
  const { ctx } = await contexto();
  const areas = tryPort('areas');

  const resuelto = await resolveAreas(
    areas && ctx ? () => areas.listAreas(ctx) : null,
    senales,
  );

  // Sin port, sin contexto, o con el port devolviendo vacío: el catálogo de
  // arranque, que sí sabe abrirse con el avance del Ritual.
  if (resuelto.source !== 'port' || resuelto.areas.length === 0) return areasDeArranque(senales);
  return resuelto.areas;
}

async function contexto() {
  const { quienEntra } = await import('./_lib/sesion');
  return (await quienEntra()) ?? { ctx: null };
}
