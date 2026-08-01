// ── Las referencias a los `.d.ts` de OTROS carriles, y por qué van aquí ──────
//
// Cargar `@abraxa/tenancy` mete sus fuentes en el programa de TypeScript de
// `apps/web`. H2 declara sus tablas y su aumentación de `express.Request` en
// tres `.d.ts` sueltos que su `index.ts` no referencia (H9 y H11 sí lo hacen
// desde los suyos), así que este programa llega a sus archivos siguiendo un
// import y NUNCA ve esos `.d.ts`: 14 errores de compilación en archivos de H2,
// provocados por un cambio de este carril.
//
// Se INCLUYEN sus archivos, no se redeclaran sus tablas: `invitations` y
// `tenant_events` no son de H11 y decirlo en un archivo de H11 sería mentira.
// El día que H2 los referencie desde su `index.ts`, esto pasa a ser un include
// repetido, que no cuesta nada. Se anota en el PR.
//
// La regla de ESLint pide un `import` en su lugar, y no aplica: un `.d.ts` no se
// puede importar sin renombrarlo a `.ts`, y renombrar un archivo de H2 sería
// justo lo que el contrato de no colisión prohíbe. Es la misma excepción, con
// la misma razón, que ya está escrita en `packages/work/src/index.ts` (H9) y en
// `packages/areas/src/index.ts` (H11).
/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../../../../packages/tenancy/src/tables.d.ts" />
/// <reference path="../../../../../packages/tenancy/src/express.d.ts" />
/// <reference path="../../../../../packages/tenancy/src/entitlements/tables.d.ts" />
/* eslint-enable @typescript-eslint/triple-slash-reference */

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
 *
 * ── EL ORDEN, que es donde el patrón heredado se rompía en silencio ────────
 *
 * `(app)/layout.tsx` pregunta `tryPort('tenancy')` ANTES de resolver la sesión,
 * y copiarlo tal cual dejaba esta pantalla exactamente igual de muerta que
 * antes. El registro de puertos de `@abraxa/db` se llena por EFECTO DE IMPORTAR
 * el paquete —`packages/tenancy/src/index.ts:144` hace el `registerPort`—, y
 * `apps/web` no importa `@abraxa/tenancy` en ninguna parte: se comprobó archivo
 * por archivo. Ni siquiera por el camino de la sesión, porque
 * `packages/auth/src/empresa.ts` dice con todas sus letras que NO lo importa —
 * habla con la API por HTTP.
 *
 * O sea que en el proceso de Next `tryPort('tenancy')` devuelve `null` SIEMPRE.
 * No falla, no avisa, no aparece en ningún log: simplemente todas las pantallas
 * que preguntan primero se quedan sin contexto para siempre. Es la misma clase
 * de fallo silencioso que `getServerSession()` sin `authOptions`, y es por lo
 * que el panel seguía saliendo genérico aunque la sesión existiera.
 *
 * Aquí el orden es el contrario y las dos cosas están cableadas:
 *
 *   1. la sesión primero —leer la cookie antes de cualquier salida temprana es
 *      además lo que impide que Next preste esta ruta como HTML estático;
 *   2. `import('@abraxa/tenancy')`, cuyo EFECTO es registrar el puerto;
 *   3. y sólo entonces `tryPort`, que ya no puede devolver `null` por un
 *      accidente de orden de carga.
 *
 * El `import` es dinámico y va dentro del `try` por lo mismo que el resto: si
 * el módulo de empresas no carga, esta pantalla lo dice y no adivina un tenant.
 */
export async function contextoDelMapa(): Promise<TenantContext | null> {
  try {
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

    // Importarlo ES registrarlo. Sin esta línea, `tryPort` de abajo devuelve
    // `null` en el proceso de Next pase lo que pase. Ver el bloque de arriba.
    await import('@abraxa/tenancy');

    const tenancy = tryPort('tenancy');
    if (!tenancy) return null;

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
  // ── Un solo mensaje, y a propósito ────────────────────────────────────────
  //
  // La versión anterior de esta función preguntaba `tryPort('tenancy')` para
  // distinguir «no hay sesión» de «el módulo de empresas no está». Distingue
  // nada: en el proceso de Next ese puerto sólo se registra COMO EFECTO de una
  // resolución de sesión que salió bien (ver `contextoDelMapa`), así que sin
  // sesión siempre está vacío — y el invitado con la sesión vencida, que es el
  // caso normal, se habría llevado un «algo de nuestro lado no responde» y
  // ningún botón. Un diagnóstico que sólo acierta en el caso raro no vale lo
  // que cuesta.
  //
  // Los dos caminos que quedan —sesión vencida, o empresa que todavía no
  // existe— se arreglan igual: volviendo a entrar. Así que se dice una cosa y
  // se ofrece la salida que sirve.
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
