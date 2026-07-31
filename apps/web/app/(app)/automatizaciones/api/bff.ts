/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El BFF de las automatizaciones: navegador → aquí → apps/api.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La pantalla NUNCA habla directo con `apps/api`. Habla con estas rutas, que
 *  corren en el servidor de Next, leen la sesión verificada y ponen las
 *  cabeceras del contrato BFF→API que H1 dejó en `@abraxa/config`.
 *
 *  Ése es el punto entero: el correo y la empresa salen de la SESIÓN, jamás de
 *  lo que mandó el navegador. Si vinieran del cliente, cualquiera cambiaría un
 *  `x-tenant-slug` y activaría las automatizaciones de otra empresa.
 *
 *  Mismo patrón que el BFF de la bandeja (H6), y a propósito: dos formas de
 *  hacer lo mismo en el mismo repo es cómo una de las dos se queda sin la
 *  corrección que sí recibió la otra.
 *
 *  ── Lo que falta, y por qué está así ───────────────────────────────────────
 *
 *  La sesión la entrega H18 (identidad). Mientras no aterrice, `sesion()`
 *  devuelve `null` y estas rutas responden **501 diciendo a quién se espera**,
 *  en vez de inventarse un usuario. Un BFF que "mientras tanto" confía en una
 *  cabecera del navegador es exactamente cómo se cuela un agujero de
 *  aislamiento a producción — pasó cuatro veces en este repo en dos días.
 *
 *  Para ver y probar la pantalla sin sesión hay un modo de demostración con
 *  datos en memoria, apagado por partida doble: `NODE_ENV !== 'production'`
 *  **y** `ABRAXA_FLOWS_DEMO=1`.
 */
import { HEADER } from '@abraxa/config';
import { NextResponse } from 'next/server';

export interface Sesion {
  userEmail: string;
  tenantSlug: string;
}

/**
 * La sesión verificada del servidor.
 *
 * TODO(H18): leer next-auth y devolver `{ userEmail, tenantSlug }`. El
 * cableado es de H18 porque la sesión es suya; aquí sólo se consume.
 */
export async function sesion(): Promise<Sesion | null> {
  return null;
}

/** `true` cuando se puede servir el juego de datos de demostración. */
export function modoDemo(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ABRAXA_FLOWS_DEMO === '1';
}

/** La base INTERNA de `apps/api`. Servidor a servidor, nunca desde el navegador. */
const API = (process.env.API_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');

/** Llama a `apps/api` bajo el prefijo `/flows` con las cabeceras del contrato. */
export async function api(s: Sesion, ruta: string, init: RequestInit = {}): Promise<NextResponse> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [HEADER.userEmail]: s.userEmail,
    [HEADER.tenantSlug]: s.tenantSlug,
  };
  const secreto = process.env.PROXY_SECRET;
  if (secreto) headers[HEADER.proxySecret] = secreto;

  try {
    const res = await fetch(`${API}/flows${ruta}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      cache: 'no-store',
    });
    const cuerpo = await res.json().catch(() => ({}));
    // `no-store` también de salida: el panel en vivo pide esto cada segundo y
    // un proxy intermedio que lo cachee lo dejaría congelado mientras la
    // corrida avanza de verdad.
    return NextResponse.json(cuerpo, {
      status: res.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL',
          message: `No se pudo hablar con la API (${err instanceof Error ? err.message : 'desconocido'}).`,
        },
      },
      { status: 502 },
    );
  }
}

/** La respuesta honesta mientras no haya sesión. */
export function sinSesion(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'PORT_NOT_IMPLEMENTED',
        message:
          'Todavía no hay sesión que verificar: la entrega H18 (identidad). Las ' +
          'automatizaciones no inventan un usuario ni leen la empresa de una cabecera del ' +
          'navegador. Para ver la pantalla con datos de prueba: ABRAXA_FLOWS_DEMO=1 npm run dev:web',
      },
    },
    { status: 501 },
  );
}
