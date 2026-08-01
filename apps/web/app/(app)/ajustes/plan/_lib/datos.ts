/**
 * La única puerta por la que esta pantalla obtiene datos.
 *
 * ── Tres estados y ni uno más ──────────────────────────────────────────────
 *
 *   'datos'       la API contestó. Puede venir vacía, y eso NO es un error.
 *   'error'       la API contestó mal o no contestó. Se dice por qué.
 *   'sin-cablear' la API todavía no monta `/entitlements` (o no hay sesión que
 *                 verificar). Es un estado DISTINTO del error, y separarlo es
 *                 lo que evita que alguien pierda una tarde depurando datos que
 *                 nunca fueron reales.
 *
 * Es el mismo criterio de H15 (`H15-crm.md §8`) y de H5 con la navegación de
 * prueba: la pantalla nunca miente sobre de dónde salió lo que está pintando.
 * En la pantalla de PLAN importa el doble — un cero silencioso aquí dice
 * "no tienes nada contratado", que es la peor cosa que le puedes decir por
 * error a alguien que acaba de pagar.
 */
import { headers } from 'next/headers';
import { toLoadFailure, type LoadFailure } from '@abraxa/ui';
import type { RespuestaPlan } from './tipos';

export type Resultado<T> =
  | { estado: 'datos'; datos: T }
  | { estado: 'error'; falla: LoadFailure }
  | { estado: 'sin-cablear'; motivo: string };

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3100';

/**
 * Cabeceras del contrato BFF→API.
 *
 * El correo sale SIEMPRE de una sesión verificada server-side, nunca de lo que
 * mandó el navegador; las pone el middleware del BFF (H18). Mientras no
 * existan, esta función devuelve `null` y la pantalla entra en 'sin-cablear',
 * que es la respuesta honesta. Inventar un correo "mientras tanto" es
 * exactamente el agujero que `contextoDePeticion()` existe para cerrar.
 */
function cabeceras(): Record<string, string> | null {
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

/**
 * Trae todo lo que pinta la pantalla en una sola petición.
 *
 * Una y no cuatro a propósito: los cuatro bloques cuentan la misma historia, y
 * verlos aparecer de uno en uno hace que la pantalla parezca estar cargando
 * para siempre justo cuando el usuario está decidiendo si pagar.
 */
export async function cargarPlan(): Promise<Resultado<RespuestaPlan>> {
  const cab = cabeceras();
  if (!cab) {
    return {
      estado: 'sin-cablear',
      motivo:
        'Todavía no hay sesión verificada en el navegador: la entrega H18 (identidad) y la ' +
        'cablea el BFF. Hasta entonces esta pantalla no puede pedir tus datos sin inventarse ' +
        'quién eres.',
    };
  }

  try {
    const r = await fetch(`${BASE}/entitlements/plan`, { headers: cab, cache: 'no-store' });

    /*
     * 404 y 501 son el caso "falta un merge", no "algo se rompió".
     *
     * `/entitlements/plan` existe siempre que el router esté montado, así que
     * un 404 aquí sólo puede querer decir que no lo está — y montarlo es UNA
     * línea en `packages/tenancy/src/index.ts` (H2) o en
     * `apps/api/src/packages.ts` (H1), ninguno de los dos de este carril.
     */
    if (r.status === 404 || r.status === 501) {
      return {
        estado: 'sin-cablear',
        motivo:
          'La API todavía no monta /entitlements. Es una línea en packages/tenancy/src/index.ts ' +
          '(de H2) o en apps/api/src/packages.ts (de H1); H16 no puede escribirla en su propio ' +
          'PR sin salirse de su carril. Está anotada como enganche en docs/handoffs/' +
          'H16-entitlements.md §11.',
      };
    }

    if (!r.ok) return { estado: 'error', falla: toLoadFailure(r) };

    return { estado: 'datos', datos: (await r.json()) as RespuestaPlan };
  } catch (e) {
    return { estado: 'error', falla: toLoadFailure(e) };
  }
}
