/**
 * Trae la declaración de `req.tenant` de H2. NO es decorativo y no se puede
 * borrar: sin ella, el `import()` de `packages/tenancy/src/port` de más abajo
 * mete `middleware/rbac.ts` en el proyecto de `apps/web` y ahí `req.tenant` no
 * existe — seis errores en código ajeno que además no está roto. Es un import
 * SÓLO de tipos: no emite nada y webpack no lo ve.
 */
import type {} from '../../../../../../packages/tenancy/src/express';
import { PlatformError, tryPort, type TenancyPort, type TenantContext } from '@abraxa/db';
import { RUTA_DE_ENTRADA } from '../../../../../../packages/auth/src/identidad';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  De la sesión del navegador al `TenantContext` verificado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Estas pantallas son Server Components: leen la bóveda llamando a
 *  `@abraxa/vault/api` directamente, sin pasar por HTTP.
 *
 *  Eso no es una comodidad, es lo correcto: el salto navegador→API es
 *  justamente donde un `x-user-email` se puede falsificar, y el patrón de
 *  GARDEN que hay que conservar dice que ese header SÓLO lo pone el servidor
 *  desde una sesión verificada. Si el dato nunca sale del servidor, no hay
 *  header que falsificar.
 *
 *  ── Qué cambió el 2026-08-01, y por qué el ensayo lo exigía ────────────────
 *
 *  Hasta hoy `correoDeLaSesion()` devolvía `null` con un `TODO(H2)`. La
 *  consecuencia no era un hueco discreto: /direccion le enseñaba al invitado la
 *  frase «Falta: H2 · packages/tenancy». Nombre de carril y ruta de paquete, en
 *  la cara de alguien que vino a ver un producto.
 *
 *  Se cablearon las DOS piezas que faltaban, porque una sin la otra no sirve:
 *
 *   1. **La sesión** (§ `sesionVerificada`). Existe desde H18 y se lee con
 *      `getServerSession(authOptions)`.
 *
 *   2. **El registro del port** (§ `puertoDeEmpresas`). Éste es el que nadie
 *      había visto: `registerPort('tenancy', …)` corre como efecto de importar
 *      `@abraxa/tenancy`, y en todo `apps/web` NADIE lo importaba. En el
 *      proceso de Next `tryPort('tenancy')` era null SIEMPRE — con sesión o sin
 *      ella, antes y después de que H2 mergeara. Cablear sólo la sesión habría
 *      dejado la misma pantalla muerta con otro texto encima.
 *
 *  ── Y una regla nueva: aquí no sale jerga ──────────────────────────────────
 *
 *  `BovedaNoDisponible` ya no lleva "quién falta". Lleva lo que el cliente
 *  necesita: qué pasó, en su idioma, y el botón que lo saca de ahí. El nombre
 *  del carril, el del paquete y el mensaje técnico van al LOG del servidor, que
 *  es donde sirven de algo.
 */

/** Qué salió mal, en las cuatro formas que le importan a quien está mirando. */
export type MotivoBoveda = 'sin-sesion' | 'sin-empresa' | 'sin-acceso' | 'no-disponible';

/** El botón que saca al cliente del estado en que se quedó. Nunca un callejón. */
export interface AccionSugerida {
  texto: string;
  href: string;
}

/**
 * La bóveda no se puede leer, y se sabe por qué.
 *
 * `titulo` y `explicacion` se PINTAN: están escritos para el dueño de un
 * negocio, no para quien programó esto. `pista` NO se pinta nunca — es la línea
 * que se manda al log del servidor, para poder diagnosticar sin obligar al
 * cliente a leer el diagnóstico.
 */
export class BovedaNoDisponible extends Error {
  constructor(
    readonly motivo: MotivoBoveda,
    readonly titulo: string,
    readonly explicacion: string,
    readonly accion: AccionSugerida | null = null,
    readonly pista = '',
  ) {
    super(`${motivo}: ${titulo}`);
    this.name = 'BovedaNoDisponible';
  }
}

/** El estado "es culpa nuestra", que aparece desde dos sitios distintos. */
function falloNuestro(pista = ''): BovedaNoDisponible {
  return new BovedaNoDisponible(
    'no-disponible',
    'No pudimos abrir tu bóveda',
    'Es un problema nuestro, no algo que hayas hecho mal. Vuelve a intentarlo en un momento.',
    { texto: 'Reintentar', href: '/direccion' },
    pista,
  );
}

/**
 * Atajo SÓLO de desarrollo, para poder ver estas pantallas sin una sesión.
 *
 * Fail-closed por diseño: exige `NODE_ENV !== 'production'` **y** que alguien
 * haya puesto la variable a mano. En producción no hay forma de encenderlo, ni
 * por accidente ni por una variable de entorno mal copiada.
 */
function contextoDeDesarrollo(): TenantContext | null {
  if (process.env.NODE_ENV === 'production') return null;

  const tenantId = process.env.VAULT_DEV_TENANT_ID;
  const tenantSlug = process.env.VAULT_DEV_TENANT_SLUG;
  if (!tenantId || !tenantSlug) return null;

  console.warn(
    '[direccion] usando VAULT_DEV_TENANT_ID: contexto de DESARROLLO sin sesión verificada. ' +
      'Esto no existe en producción.',
  );

  return {
    tenantId,
    tenantSlug,
    userEmail: process.env.VAULT_DEV_USER_EMAIL ?? 'dev@localhost',
    role: 'owner',
    areas: { direccion: 'admin' },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// La sesión
// ════════════════════════════════════════════════════════════════════════════

interface SesionDeNextAuth {
  user?: { email?: string | null; tenantSlug?: string | null } | null;
}

/** Para no repetir el mismo aviso en cada render. Uno por proceso basta. */
let yaAvisadoSinSesion = false;
let yaAvisadoSinPuerto = false;

/**
 * Quién está mirando la pantalla, desde la cookie firmada.
 *
 * ── `authOptions` NO ES OPCIONAL ──────────────────────────────────────────
 *
 * `getServerSession()` sin ellas compila, no lanza y no escribe un solo log —y
 * nunca ejecuta el callback `session`, que es quien pone `tenantSlug`. El
 * síntoma es el peor posible: el invitado entra con Google, la aplicación le
 * dice que no ha entrado, y no hay ni un error que buscar. Le pasó al Ritual
 * (PR #27) y a la bandeja. Aquí se pasan desde la primera línea.
 *
 * ── Por qué los imports son dinámicos ─────────────────────────────────────
 *
 * Para que un fallo del módulo de sesión —falta `NEXTAUTH_SECRET`, el módulo de
 * H18 cambió de sitio— degrade a "no hay sesión" en vez de tumbar el render
 * entero. Falla CERRADO: cualquier error devuelve `null`, jamás un usuario
 * inventado. Es el mismo patrón de `(app)/layout.tsx`.
 */
async function sesionVerificada(): Promise<{
  userEmail: string;
  tenantSlug: string | null;
} | null> {
  try {
    const [{ getServerSession }, { authOptions }] = await Promise.all([
      import('next-auth/next') as unknown as Promise<{
        getServerSession: (o: unknown) => Promise<SesionDeNextAuth | null>;
      }>,
      import('../../../api/auth/opciones'),
    ]);

    const sesion = await getServerSession(authOptions);
    const correo = sesion?.user?.email;
    if (!correo) return null;

    const slug = sesion.user?.tenantSlug;
    return {
      userEmail: correo.trim().toLowerCase(),
      tenantSlug: slug && slug.length > 0 ? slug : null,
    };
  } catch (e) {
    // Un `catch` mudo aquí sería indistinguible de «el invitado no ha entrado»,
    // que es exactamente el fallo silencioso que nos costó el ensayo.
    if (!yaAvisadoSinSesion) {
      yaAvisadoSinSesion = true;
      console.error(
        `[direccion] no se pudo resolver la sesión: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// El registro de empresas
// ════════════════════════════════════════════════════════════════════════════

/**
 * El `TenancyPort`, registrándolo si hace falta.
 *
 * ── El fallo que esto cierra ──────────────────────────────────────────────
 *
 * `registerPort('tenancy', tenancyPort)` es un efecto secundario de
 * `packages/tenancy/src/index.ts`. Sólo corre si alguien importa el paquete, y
 * el único que lo importa es `apps/api/src/packages.ts`. En el proceso de Next
 * nadie lo hacía, así que `tryPort('tenancy')` devolvía null en TODAS las
 * pantallas del producto —no sólo aquí— y cada una lo leía como "H2 todavía no
 * aterriza". H2 llevaba días mergeado.
 *
 * ── Por qué el módulo profundo y no el barril ─────────────────────────────
 *
 * `@abraxa/tenancy` reexporta su router de Express desde `index.ts`. Arrastrar
 * Express a la compilación de Next para conseguir un objeto de cuatro funciones
 * es caro y arriesgado — es la misma razón por la que la bóveda publica
 * `@abraxa/vault/api` aparte de su barril. `src/port.ts` es justo el port y sus
 * servicios: cero Express.
 *
 * ── Por qué la ruta va ESCRITA y no en una constante ──────────────────────
 *
 * Se intentó primero con la ruta en una constante —el recurso de
 * `(app)/bandeja/api/bff.ts` y de `(onboarding)/ritual/lib/sesion.ts`— para
 * que TypeScript no siguiera el módulo. Webpack NO la pliega: contesta
 * «Critical dependency: the request of a dependency is an expression», arma un
 * módulo de contexto cuyo patrón por defecto sólo casa con `./…`, y una ruta
 * que empieza con `../` no casa nunca. O sea: compila, no avisa en rojo, y
 * falla en la primera petición real. (Los dos archivos citados llevan esa
 * misma advertencia en `main` hoy — anotado en el PR, no son míos.)
 *
 * Escrita literal, webpack la resuelve. Lo que rompe entonces es TypeScript:
 * mete el árbol de H2 en el proyecto de `apps/web` y ahí `middleware/rbac.ts`
 * usa `req.tenant`, que sólo existe con `packages/tenancy/src/express.d.ts`
 * cargado — y ese `.d.ts` no entra en el `include` de la web. Es la mina
 * conocida ("packages/** no alcanza los tipos de next") vista por el otro
 * lado. Se arregla con el `/// <reference>` de la primera línea de este
 * archivo: carga la declaración y ya. Cero archivos ajenos tocados.
 *
 * Se deja en el registro compartido (y no en una variable de aquí) para que la
 * siguiente pantalla que llame `tryPort('tenancy')` en este proceso —el shell
 * de `(app)/layout.tsx`, el mapa, las tareas— ya lo encuentre. Esta función
 * arregla su carril y, de paso, deja de romper los ajenos.
 */
async function puertoDeEmpresas(): Promise<TenancyPort | null> {
  const registrado = tryPort('tenancy');
  if (registrado) return registrado;

  try {
    const [{ registerPort }, { tenancyPort }] = await Promise.all([
      import('@abraxa/db'),
      import('../../../../../../packages/tenancy/src/port'),
    ]);

    registerPort('tenancy', tenancyPort);
    return tryPort('tenancy');
  } catch (e) {
    if (!yaAvisadoSinPuerto) {
      yaAvisadoSinPuerto = true;
      console.error(
        `[direccion] no se pudo registrar el port de empresas: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// El contexto
// ════════════════════════════════════════════════════════════════════════════

/**
 * El contexto de quien está viendo la pantalla.
 *
 * Lanza `BovedaNoDisponible` cuando falta una pieza. La pantalla enseña el
 * título y la explicación tal cual, con su botón: nunca un error genérico y
 * nunca una tabla vacía que se lea como «no tienes datos».
 */
export async function contextoActual(): Promise<TenantContext> {
  const dev = contextoDeDesarrollo();
  if (dev) return dev;

  const sesion = await sesionVerificada();
  if (!sesion) {
    // En producción el middleware ya manda a la entrada antes de llegar aquí.
    // Esto es la segunda red, no la primera.
    throw new BovedaNoDisponible(
      'sin-sesion',
      'Entra para ver tu bóveda',
      'Aquí viven los números y los documentos de tu negocio, así que primero necesitamos saber quién eres.',
      { texto: 'Entrar', href: `${RUTA_DE_ENTRADA}?callbackUrl=%2Fdireccion` },
    );
  }

  const tenancy = await puertoDeEmpresas();
  if (!tenancy) {
    throw falloNuestro('tryPort("tenancy") sigue vacío tras intentar registrarlo.');
  }

  const tenantSlug = sesion.tenantSlug ?? (await empresaDelCorreo(sesion.userEmail, tenancy));
  if (!tenantSlug) {
    throw new BovedaNoDisponible(
      'sin-empresa',
      'Todavía no tienes un negocio aquí',
      'Tu bóveda se llena cuando nos cuentas a qué te dedicas. Son unos minutos, y de ahí sale todo lo demás.',
      { texto: 'Crear mi negocio', href: '/ritual' },
    );
  }

  try {
    return await tenancy.contextFor({ userEmail: sesion.userEmail, tenantSlug });
  } catch (e) {
    if (PlatformError.is(e) && e.code === 'FORBIDDEN') {
      throw new BovedaNoDisponible(
        'sin-acceso',
        'Esta bóveda no es tuya',
        'Tu cuenta no tiene acceso a este negocio. Si crees que debería tenerlo, pídele a quien lo administra que te invite.',
        null,
        `contextFor negó ${sesion.userEmail} → ${tenantSlug}`,
      );
    }

    // Cualquier otra cosa —la base caída, una variable sin poner— es un fallo
    // nuestro y se cuenta como tal. El detalle va al log, no a la pantalla.
    console.error(
      `[direccion] contextFor falló para ${tenantSlug}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    throw falloNuestro();
  }
}

/**
 * La empresa del correo, cuando la sesión no la trae.
 *
 * Pasa en una ventana real: quien entró ANTES de tener empresa conserva un
 * token sin `tenantSlug` hasta que caduca. Sin este rescate, un cliente con su
 * negocio ya creado vería «todavía no tienes un negocio aquí» durante días.
 */
async function empresaDelCorreo(userEmail: string, tenancy: TenancyPort): Promise<string | null> {
  try {
    return await tenancy.primaryTenantSlugFor(userEmail);
  } catch (e) {
    console.error(
      `[direccion] primaryTenantSlugFor falló: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}
