/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El BFF de la bandeja: navegador → aquí → apps/api.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La pantalla NUNCA habla directo con `apps/api`. Habla con estas rutas, que
 *  corren en el servidor de Next, leen la sesión verificada y ponen las
 *  cabeceras del contrato BFF→API que H1 dejó en `@abraxa/config`:
 *
 *      x-user-email · x-tenant-slug · x-proxy-secret
 *
 *  Ese es el punto entero: el correo y la empresa salen de la SESIÓN, jamás de
 *  lo que mandó el navegador. Si vinieran del cliente, cualquiera cambiaría un
 *  `x-tenant-slug` y leería la bandeja de otra empresa.
 *
 *  ── Lo que falta, y por qué está así ───────────────────────────────────────
 *
 *  La sesión la entrega H2 (`TenancyPort` + next-auth). Mientras no aterrice,
 *  `sesion()` devuelve `null` y estas rutas responden **501 diciendo a quién se
 *  espera**, en vez de inventarse un usuario. Un BFF que "mientras tanto"
 *  confía en una cabecera del navegador es exactamente cómo se cuela un agujero
 *  de aislamiento a producción.
 *
 *  Para poder ver y probar la pantalla sin H2 existe un modo de demostración
 *  con datos en memoria, apagado por partida doble: `NODE_ENV !== 'production'`
 *  **y** `ABRAXA_INBOX_DEMO=1`.
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
 * TODO(H2): leer next-auth y devolver `{ userEmail, tenantSlug }`. El cableado
 * es de H2 porque la sesión es suya; aquí sólo se consume.
 */
export async function sesion(): Promise<Sesion | null> {
  return null;
}

/** `true` cuando se puede servir el juego de datos de demostración. */
export function modoDemo(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ABRAXA_INBOX_DEMO === '1';
}

const API = (process.env.API_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');

/** Llama a `apps/api` con las cabeceras del contrato. */
export async function api(
  s: Sesion,
  ruta: string,
  init: RequestInit = {},
): Promise<NextResponse> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [HEADER.userEmail]: s.userEmail,
    [HEADER.tenantSlug]: s.tenantSlug,
  };
  const secreto = process.env.PROXY_SECRET;
  if (secreto) headers[HEADER.proxySecret] = secreto;

  try {
    const res = await fetch(`${API}/inbox${ruta}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      cache: 'no-store',
    });
    const cuerpo = await res.json().catch(() => ({}));
    return NextResponse.json(cuerpo, { status: res.status });
  } catch (err) {
    // La API caída no es un 500 genérico: la pantalla distingue "red" de
    // "servidor" y ofrece reintentar sólo cuando sirve.
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

/** La respuesta honesta mientras H2 no exista. */
export function sinSesion(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'PORT_NOT_IMPLEMENTED',
        message:
          'Todavía no hay sesión que verificar: la entrega H2 (tenancy). La bandeja no ' +
          'inventa un usuario ni lee el tenant de una cabecera del navegador. ' +
          'Para ver la pantalla con datos de prueba: ABRAXA_INBOX_DEMO=1 npm run dev:web',
      },
    },
    { status: 501 },
  );
}
