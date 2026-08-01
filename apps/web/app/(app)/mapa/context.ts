import { tryPort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';

/**
 * El contexto del tenant para el Mapa de Negocio.
 *
 * ── Lo que estaba roto, y era el hallazgo #1 del ensayo ────────────────────
 *
 * Hasta el 2026-08-01 esto devolvía `null` bajo un `TODO(H18/H2)` y era la
 * respuesta honesta: no había sesión que verificar. Pero los DOS botones con los
 * que cierra el Ritual —el pago de 20 minutos de preguntas— apuntan a `/mapa`, y
 * `/mapa` con `null` contestaba «El módulo de sesión y empresa (H2) todavía no
 * está registrado». O sea: el último turno del producto entregaba una pantalla
 * muerta, y encima le hablaba al cliente en jerga interna.
 *
 * La sesión existe desde H18 (PR #25). Aquí se cablea, con el patrón que ya
 * resolvió `(app)/layout.tsx` — el mismo, línea por línea, a propósito: dos
 * resolvedores de sesión distintos en el mismo árbol son dos maneras distintas
 * de equivocarse.
 *
 * ── Las tres cosas que NO se pueden cambiar de este patrón ─────────────────
 *
 *  1. `authOptions` NO ES OPCIONAL. `getServerSession()` sin ellas no ejecuta
 *     el callback `session` —que vive dentro y es quien pone `tenantSlug`— y
 *     devuelve una sesión incompleta SIN error y SIN log. Es exactamente el
 *     fallo silencioso que tuvo el Ritual: invitado autenticado, pantalla
 *     pidiéndole entrar.
 *  2. LOS IMPORTS SON DINÁMICOS, para que un fallo del módulo de sesión no
 *     tumbe la pantalla entera.
 *  3. FALLA CERRADO. Sin correo y sin empresa verificados no se arma contexto,
 *     y sin contexto no se lee el mapa de nadie. Lo que NO se hace nunca es
 *     leer el correo de una cabecera o de una cookie y seguir adelante: ese 403
 *     es lo único que impide que el cliente A vea el mapa del B, y es
 *     exactamente cómo se coló un agujero de aislamiento a `main` el 2026-07-31.
 */
export async function contextoDelMapa(): Promise<TenantContext | null> {
  try {
    const tenancy = tryPort('tenancy');
    if (!tenancy) return null;

    const [{ getServerSession }, { authOptions }] = await Promise.all([
      import('next-auth/next') as unknown as Promise<{
        getServerSession: (o: unknown) => Promise<{
          user?: { email?: string | null; tenantSlug?: string | null } | null;
        } | null>;
      }>,
      import('../../api/auth/opciones'),
    ]);

    const sesion = await getServerSession(authOptions);
    const userEmail = sesion?.user?.email;
    const tenantSlug = sesion?.user?.tenantSlug;
    if (!userEmail || !tenantSlug) return null;

    return await tenancy.contextFor({ userEmail, tenantSlug });
  } catch {
    // Falla CERRADO: sin contexto verificado no se pide el mapa de nadie.
    return null;
  }
}

/**
 * Qué decirle al invitado cuando no hay contexto, y a dónde mandarlo.
 *
 * ── Esto ya no habla de módulos ni de handoffs ─────────────────────────────
 *
 * El hallazgo #5 del ensayo es que cinco pantallas le contestan al cliente con
 * jerga interna —«Falta: H2 · packages/tenancy», «migraciones 130-132»—. Ésta
 * era una de ellas. Un emprendedor no sabe qué es H2 y no tiene por qué:
 * enterarse de nuestra estructura de equipos es enterarse de que el producto no
 * está terminado, en el peor momento posible para saberlo.
 *
 * Y no basta con traducirlo: un mensaje sin salida es un callejón. En
 * producción, `/mapa` está detrás del middleware, así que llegar aquí sin sesión
 * es raro —lo normal es que te haya mandado a entrar antes—; lo que sí pasa es
 * llegar con sesión pero sin empresa todavía. Por eso hay dos textos y los dos
 * llevan a algún sitio.
 */
export interface SinContexto {
  titulo: string;
  descripcion: string;
  accion: { texto: string; href: string } | null;
}

export function motivoSinContexto(): SinContexto {
  // Sin el módulo de empresas no hay forma de saber de quién es este mapa. Es
  // un problema nuestro y se dice como tal, sin nombrarle un paquete.
  if (!tryPort('tenancy')) {
    return {
      titulo: 'Tu mapa no está disponible en este momento',
      descripcion:
        'Es cosa nuestra, no tuya: algo de nuestro lado no está respondiendo. ' +
        'Vuelve a cargar en un minuto y, si sigue igual, escríbenos.',
      accion: null,
    };
  }

  return {
    titulo: 'Necesitamos saber quién eres',
    descripcion:
      'Tu sesión no está activa o todavía no tienes una empresa a tu nombre. ' +
      'Entra otra vez y te llevamos directo a tu mapa.',
    accion: { texto: 'Entrar', href: '/api/auth/signin?callbackUrl=%2Fmapa' },
  };
}

/**
 * Lo mismo, en UNA frase, para el `{ ok, error }` de una server action.
 *
 * Una acción que falla no puede abrir una pantalla ni pintar un botón: sólo
 * tiene una línea de texto para explicarse. Que salga de la misma función que el
 * estado vacío es lo que evita que dentro de tres meses una diga «entra otra
 * vez» y la otra siga hablando de módulos.
 */
export function motivoSinContextoTexto(): string {
  const { descripcion } = motivoSinContexto();
  return descripcion;
}
