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
 *  El handler de sesión es de H18. Mientras no aterrice, `sesion()` devuelve
 *  `null` y estas rutas responden **501 diciendo a quién se espera**, en vez de
 *  inventarse un usuario. Un BFF que "mientras tanto" confía en una cabecera
 *  del navegador es exactamente cómo se cuela un agujero de aislamiento a
 *  producción.
 *
 *  Para poder ver y probar la pantalla sin sesión existe un modo de
 *  demostración con datos en memoria, apagado por partida doble:
 *  `NODE_ENV !== 'production'` **y** `ABRAXA_INBOX_DEMO=1`.
 */
import { HEADER } from '@abraxa/config';
import { NextResponse } from 'next/server';

export interface Sesion {
  userEmail: string;
  tenantSlug: string;
}

/** La forma mínima de la sesión que aquí hace falta. */
interface SesionDeNextAuth {
  user?: { email?: string | null; tenantSlug?: string | null } | null;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⚠️  UNA LÍNEA QUE HAY QUE CAMBIAR CUANDO H18 MERGEE. Ver abajo.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Dónde vive la configuración de next-auth. Es de **H18**
 * (`apps/web/app/api/**`), y desde aquí la ruta relativa es ésta:
 *
 *     app/(app)/bandeja/api/  →  ../../../  →  app/  →  api/auth/opciones
 *
 * ── Por qué es una constante y no el literal que pide el contrato ──────────
 *
 * Porque hoy el archivo **no existe** en esta rama, y las dos formas fallan por
 * lados opuestos. Ambas cosas están MEDIDAS, no supuestas (2026-08-01):
 *
 *   · Literal `await import('../../../api/auth/opciones')`
 *       → `tsc`  : TS2307 «Cannot find module».
 *       → `next build`: **falla**, «Module not found: Can't resolve».
 *   · Constante (esto)
 *       → `tsc`  : limpio.
 *       → `next build`: compila, con el aviso «Critical dependency: the
 *         request of a dependency is an expression».
 *
 * Sólo la constante deja pasar `typecheck` + `build` hoy, que es lo que el
 * contrato exige para poder empujar sin esperar a H18.
 *
 * ── Y por eso mismo NO se resuelve sola mañana ─────────────────────────────
 *
 * Ese aviso de webpack significa que el módulo **no queda dentro del paquete**:
 * el especificador no es analizable, así que el empaquetador no puede incluirlo
 * y en tiempo de ejecución la ruta relativa se resolvería contra el chunk
 * compilado, no contra este archivo. Es decir: si nadie toca nada, esto seguiría
 * cayendo al `catch` **incluso después de que H18 mergee**, y el síntoma sería
 * «entro con Google y la bandeja insiste en que no hay sesión» — silencioso,
 * que es justo la clase de fallo que este PR se dedicó a cerrar.
 *
 * Por eso el `catch` de abajo **avisa en el log** en vez de callarse.
 *
 * **EL DÍA QUE `apps/web/app/api/auth/opciones.ts` ESTÉ EN `main`:** sustituir
 * `RUTA_OPCIONES` por el literal y borrar esta constante. Es una línea, y a
 * partir de ahí el módulo entra al paquete y la sesión funciona de verdad.
 */
const RUTA_OPCIONES = '../../../api/auth/opciones';

/** Para no repetir el aviso en cada petición a la bandeja. */
let yaAvisadoSinSesion = false;

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La sesión verificada del servidor. (Contrato de sesión H0-B, 2026-07-31)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * next-auth v4 + Google. El handler y la configuración son de **H18**:
 *
 *     apps/web/app/api/auth/[...nextauth]/route.ts
 *     apps/web/app/api/auth/opciones.ts        ← export NOMBRADO `authOptions`
 *
 * `user.tenantSlug` lo pone H18 en el callback de `session`.
 *
 * ── `authOptions` SE PASA. No es un detalle ────────────────────────────────
 *
 * `getServerSession()` **sin argumentos** compila y devuelve `null` siempre: en
 * el App Router no encuentra la configuración por su cuenta, así que nunca
 * llega a mirar la cookie. El patrón que hoy vive en `main`
 * (`(onboarding)/ritual/lib/sesion.ts`, de H7) parecía correcto sólo porque
 * jamás corrió con una sesión real — habría contestado "sin sesión" al primer
 * usuario de verdad, y el síntoma sería «inicio sesión con Google y la
 * aplicación me sigue diciendo que no he entrado». Aquí se pasa desde ya.
 *
 * ── Por qué el import sigue siendo dinámico y dentro de un `try` ───────────
 *
 * `opciones.ts` es de H18 y todavía no está en esta rama. El import dinámico
 * dentro de `try` hace dos cosas a la vez: hoy degrada a "sin sesión" —que es
 * justo lo que la bandeja ya sabe contestar, con `sinSesion()`— y el día que
 * H18 mergee empieza a funcionar **sin tocar una línea de este carril**. Por
 * eso este archivo no espera a H18 para empujarse.
 *
 * ── Por qué es seguro que el slug venga de la sesión ───────────────────────
 *
 * La cookie va firmada con `NEXTAUTH_SECRET`. Y aunque alguien la falsificara,
 * aquí no se decide nada: quien decide es `contextoDePeticion(req)` en la API,
 * que revalida la membresía contra `TenancyPort.contextFor()` y tira 403. El
 * slug que viaja en la cabecera **nunca se cree**.
 */
export async function sesion(): Promise<Sesion | null> {
  try {
    const { getServerSession } = await import('next-auth/next');
    const { authOptions } = await import(RUTA_OPCIONES);

    const s = (await getServerSession(authOptions)) as SesionDeNextAuth | null;

    const userEmail = s?.user?.email;
    const tenantSlug = s?.user?.tenantSlug;
    if (!userEmail || !tenantSlug) return null;

    return { userEmail: userEmail.trim().toLowerCase(), tenantSlug };
  } catch (err) {
    // Todavía no existe el handler de H18 (o falta configuración). "Sin sesión"
    // es la respuesta honesta; jamás un usuario inventado.
    //
    // Pero se AVISA, una sola vez por proceso. Un `catch` mudo aquí es
    // indistinguible de «el usuario no ha entrado», y con la constante de
    // arriba este camino seguiría tomándose aunque H18 ya hubiera mergeado.
    // Esta línea es lo único que separa «falta configurar la sesión» de una
    // tarde buscando por qué la bandeja no reconoce a nadie.
    if (!yaAvisadoSinSesion) {
      yaAvisadoSinSesion = true;
      console.warn(
        `[bandeja] no se pudo resolver la sesión: ${err instanceof Error ? err.message : String(err)}. ` +
          'Si H18 ya mergeó `apps/web/app/api/auth/opciones.ts`, falta cambiar RUTA_OPCIONES ' +
          'por el literal en este archivo (ver la nota); si no, es lo esperado y la bandeja ' +
          'responde 501 a propósito.',
      );
    }
    return null;
  }
}

/** `true` cuando se puede servir el juego de datos de demostración. */
export function modoDemo(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ABRAXA_INBOX_DEMO === '1';
}

/**
 * La base INTERNA de `apps/api`. Servidor a servidor, nunca desde el navegador.
 *
 * `API_BASE_URL` significaba dos cosas incompatibles hasta el 2026-07-31: ésta,
 * y la URL PÚBLICA del webhook de Evolution (`drivers/whatsapp/index.ts`). Un
 * solo valor no puede ser las dos —una es `http://localhost:3100` o el nombre
 * del servicio en la red de contenedores; la otra tiene que ser alcanzable
 * desde internet— y la línea se veía activa mientras no entraba ni un mensaje.
 *
 * La pública se llama ahora `PUBLIC_WEBHOOK_BASE_URL`. Ésta se queda con el
 * nombre viejo y con su significado interno, que es el que ya tenía aquí: así
 * ningún despliegue actual se rompe por el cambio.
 */
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

/** La respuesta honesta mientras no haya sesión. */
export function sinSesion(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'PORT_NOT_IMPLEMENTED',
        message:
          'Todavía no hay sesión que verificar: el handler de next-auth lo entrega H18 ' +
          '(/api/auth/*). La bandeja no inventa un usuario ni lee el tenant de una ' +
          'cabecera del navegador. En cuanto H18 mergee, esto empieza a funcionar solo. ' +
          'Para ver la pantalla con datos de prueba: ABRAXA_INBOX_DEMO=1 npm run dev:web',
      },
    },
    { status: 501 },
  );
}
