/**
 * La única puerta por la que esta pantalla obtiene datos.
 *
 * ── Tres estados y ni uno más ──────────────────────────────────────────────
 *
 *   'datos'       la API contestó. Puede venir vacía, y eso NO es un error:
 *                 una empresa recién dada de alta no tiene nada conectado.
 *   'error'       la API contestó mal o no contestó. Se dice por qué.
 *   'sin-cablear' la API todavía no monta `/integrations` (o no hay sesión que
 *                 verificar). Es un estado DISTINTO del error, y separarlo es
 *                 lo que evita que alguien pierda una tarde depurando un
 *                 sistema que está bien.
 *
 * Es el mismo criterio con el que H15 resuelve su pantalla de contactos: nunca
 * miente sobre de dónde salió lo que está pintando.
 */
import { headers } from 'next/headers';
import { toLoadFailure, type LoadFailure } from '@abraxa/ui';
import type { Integration, IntegrationEvent, ProviderInfo } from './tipos';

export type Resultado<T> =
  | { estado: 'datos'; datos: T }
  | { estado: 'error'; falla: LoadFailure }
  | { estado: 'sin-cablear'; motivo: string };

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3100';

const SIN_SESION =
  'Todavía no hay sesión verificada: la entrega H18 (identidad) y la cablea el BFF. Hasta ' +
  'entonces esta pantalla no puede pedirle datos a nadie sin inventarse quién eres — y aquí ' +
  'lo que se administra son las credenciales del negocio.';

const SIN_MONTAR =
  'La API todavía no monta /integrations. Es una línea en apps/api/src/packages.ts, que es de ' +
  'H1, y está anotada en docs/handoffs/H17-integraciones.md §10.';

/**
 * Cabeceras del contrato BFF→API.
 *
 * El correo sale SIEMPRE de una sesión verificada server-side, nunca de lo que
 * mandó el navegador. Mientras no exista, esta función devuelve `null` y la
 * pantalla entra en 'sin-cablear' — que es la respuesta honesta. Inventar un
 * correo "mientras tanto" en la pantalla que administra las llaves del
 * WhatsApp del negocio sería el peor sitio posible para ese atajo.
 */
export function cabeceras(): Record<string, string> | null {
  const h = headers();
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

export const BASE_API = BASE;

async function pedir<T>(ruta: string, sinCablearEn404 = false): Promise<Resultado<T>> {
  const cab = cabeceras();
  if (!cab) return { estado: 'sin-cablear', motivo: SIN_SESION };

  try {
    const r = await fetch(`${BASE}${ruta}`, { headers: cab, cache: 'no-store' });

    // 501 = el port no está registrado en el proceso de la API. Es "falta un
    // merge", no "algo se rompió", y se muestra distinto.
    if (r.status === 501 || (r.status === 404 && sinCablearEn404)) {
      return { estado: 'sin-cablear', motivo: SIN_MONTAR };
    }
    if (!r.ok) return { estado: 'error', falla: toLoadFailure(r) };

    return { estado: 'datos', datos: (await r.json()) as T };
  } catch (e) {
    return { estado: 'error', falla: toLoadFailure(e) };
  }
}

export const cargarIntegraciones = (): Promise<Resultado<Integration[]>> => pedir('/integrations', true);

export const cargarProveedores = (): Promise<Resultado<ProviderInfo[]>> =>
  pedir('/integrations/providers', true);

export const cargarBitacora = (): Promise<Resultado<IntegrationEvent[]>> =>
  pedir('/integrations/eventos?limit=20', true);
