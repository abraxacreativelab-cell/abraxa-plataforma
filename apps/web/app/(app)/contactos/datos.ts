/**
 * La única puerta por la que esta pantalla obtiene datos.
 *
 * ── Tres estados y ni uno más ──────────────────────────────────────────────
 *
 *   'datos'      la API contestó. Puede venir vacía, y eso NO es un error.
 *   'error'      la API contestó mal o no contestó. Se dice por qué.
 *   'sin-cablear' la API todavía no monta `/crm` (o H2 no ha aterrizado y no
 *                hay sesión que verificar). Es un estado DISTINTO del error, y
 *                separarlo es lo que evita que alguien pierda una tarde
 *                depurando datos que nunca fueron reales.
 *
 * Es el mismo criterio con el que H5 resuelve la navegación (`resolveAreas` y
 * el aviso "navegación de prueba" en la barra superior): la pantalla nunca
 * miente sobre de dónde salió lo que está pintando.
 */
import { headers } from 'next/headers';
import { toLoadFailure, type LoadFailure } from '@abraxa/ui';
import type { Contact, ContactEvent, EstadisticasEmbudo } from './tipos';

export type Resultado<T> =
  | { estado: 'datos'; datos: T }
  | { estado: 'error'; falla: LoadFailure }
  | { estado: 'sin-cablear'; motivo: string };

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3100';

/**
 * Cabeceras del contrato BFF→API.
 *
 * El correo sale SIEMPRE de una sesión verificada server-side (H2), nunca de
 * lo que mandó el navegador. Mientras H2 no aterrice no hay sesión, así que
 * esta función devuelve `null` y la pantalla entra en 'sin-cablear' — que es
 * la respuesta honesta. Inventar un correo "mientras tanto" sería exactamente
 * el agujero que el guardia de `packages/crm/src/routes.ts` existe para
 * cerrar.
 */
function cabeceras(): Record<string, string> | null {
  const h = headers();
  // Las pone el middleware del BFF cuando exista. Se leen de la petición
  // entrante y no de una sesión inventada aquí.
  const correo = h.get('x-abraxa-session-email');
  const empresa = h.get('x-abraxa-session-tenant');
  if (!correo || !empresa) return null;

  const secreto = process.env.PROXY_SECRET;
  return {
    'x-user-email': correo,
    'x-tenant-slug': empresa,
    ...(secreto ? { 'x-proxy-secret': secreto } : {}),
  };
}

/**
 * `sinCablearEn404` distingue dos 404 que se ven idénticos desde aquí:
 *
 *   · `/crm/contacts` devolviendo 404 sólo puede ser que la API no monte el
 *     router — esa ruta existe siempre que esté montado.
 *   · `/crm/contacts/<id>` devolviendo 404 es lo normal: no existe ese
 *     contacto, y hay que mandar a la página de "no encontrado".
 *
 * Tratar los dos igual pintaría "falta cablear" cuando alguien abre un enlace
 * viejo de un contacto borrado, que es exactamente el tipo de mensaje que hace
 * dudar de un sistema que está bien.
 */
async function pedir<T>(ruta: string, sinCablearEn404 = false): Promise<Resultado<T>> {
  const cab = cabeceras();
  if (!cab) {
    return {
      estado: 'sin-cablear',
      motivo:
        'Todavía no hay sesión verificada: la entrega H2 (tenancy) y la cablea el BFF. ' +
        'Hasta entonces esta pantalla no puede pedirle datos a nadie sin inventarse quién eres.',
    };
  }

  try {
    const r = await fetch(`${BASE}${ruta}`, { headers: cab, cache: 'no-store' });

    // 501 = el port no está registrado en el proceso de la API. Es el caso
    // "falta un merge", no "algo se rompió", y se muestra distinto.
    if (r.status === 501 || (r.status === 404 && sinCablearEn404)) {
      return {
        estado: 'sin-cablear',
        motivo:
          'La API todavía no monta /crm. Es una línea en apps/api/src/packages.ts, que es de H1 — ' +
          'está anotada en docs/handoffs/H15-crm.md §9.',
      };
    }
    if (!r.ok) return { estado: 'error', falla: toLoadFailure(r) };

    return { estado: 'datos', datos: (await r.json()) as T };
  } catch (e) {
    return { estado: 'error', falla: toLoadFailure(e) };
  }
}

export const cargarContactos = (
  busqueda?: string,
): Promise<Resultado<{ contacts: Contact[]; total: number }>> =>
  pedir(`/crm/contacts${busqueda ? `?q=${encodeURIComponent(busqueda)}` : ''}`, true);

export const cargarEmbudo = (): Promise<Resultado<EstadisticasEmbudo>> =>
  pedir('/crm/pipelines/stats', true);

export const cargarContacto = (id: string): Promise<Resultado<Contact>> =>
  pedir(`/crm/contacts/${encodeURIComponent(id)}`);

export const cargarLinea = (id: string): Promise<Resultado<ContactEvent[]>> =>
  pedir(`/crm/contacts/${encodeURIComponent(id)}/timeline`);
