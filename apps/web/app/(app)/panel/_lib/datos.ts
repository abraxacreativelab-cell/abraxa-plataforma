import { cache } from 'react';
import { HEADER } from '@abraxa/config';
import {
  type PasoDelRitual,
  type RitualEnPanel,
  type SenalesDelRitual,
  pasosDelRitual,
  ritualEnPanel,
  senalesDelRitual,
} from '@abraxa/ui';
import { quienEntra } from './sesion';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Lo que el panel sabe del Ritual, leído UNA vez por petición
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── El defecto que esto arregla (hallazgo 4 del ensayo) ────────────────────
 *
 *  «EL PANEL MIENTE SOBRE LO QUE FALTA: con el Ritual COMPLETO sigue diciendo
 *   "Se abre cuando tu agente termine contigo El bautizo".»
 *
 *  La causa no era el catálogo de áreas, que siempre supo abrirse solo: era que
 *  `(app)/layout.tsx` llamaba a `areasDeArranque()` y `requisitosDeArranque()`
 *  SIN señales. Las dos aceptan un argumento `senales` desde el primer día y las
 *  dos lo estaban recibiendo `null`, o sea "el Ritual no ha empezado" — para
 *  todo el mundo, incluido quien ya lo había terminado.
 *
 *  Verificado contra producción el 2026-08-01: la empresa `taqueria-regia-…`
 *  tiene `onboarding_sessions.status = 'completada'` con su agente ya bautizado
 *  («Lupita»), y aun así el panel le seguía pidiendo El bautizo.
 *
 *  ── Por qué `cache()` y no dos peticiones ──────────────────────────────────
 *
 *  El shell y el panel necesitan LA MISMA foto: si la barra lateral dijera que
 *  Ventas está abierta y el mosaico que no, el producto se estaría
 *  contradiciendo a sí mismo en la misma pantalla.
 *
 *  `cache()` de React memoiza por petición: el layout la pide, la página la
 *  vuelve a pedir y sale la misma sin un segundo viaje a la API. `fetch` no
 *  serviría — va con `no-store`, que es lo correcto (un panel que se enseña
 *  cacheado enseña el avance de hace cinco minutos) y por eso mismo no deduplica.
 *
 *  ── Y por qué la API por HTTP y no un port ─────────────────────────────────
 *
 *  Porque el Ritual vive en Express, detrás del contrato BFF→API, y el mismo
 *  camino que ya usa `(onboarding)/ritual/page.tsx`. `apps/web/app/api/**` NO
 *  sirve: en producción nginx manda `/api/*` al 3040 (Express) y esas rutas de
 *  Next están muertas — salvo `/api/auth/*`, que tiene su propio bloque.
 */

export interface FotoDelPanel {
  /** `null` si no hay sesión o no hay empresa. */
  userEmail: string | null;
  tenantSlug: string | null;
  /** El nombre REAL de la empresa. Nunca el slug. */
  tenantName: string | null;
  /** `true` si hay persona pero no se le pudo resolver empresa. */
  sinEmpresa: boolean;
  ritual: RitualEnPanel | null;
  pasos: PasoDelRitual[];
  senales: SenalesDelRitual | null;
  /** `true` si la foto del Ritual no se pudo leer. Se dice, no se disimula. */
  ritualNoDisponible: boolean;
}

const VACIA: FotoDelPanel = {
  userEmail: null,
  tenantSlug: null,
  tenantName: null,
  sinEmpresa: false,
  ritual: null,
  pasos: [],
  senales: null,
  ritualNoDisponible: false,
};

/**
 * La foto completa, memoizada por petición.
 *
 * NUNCA lanza. El panel es la primera pantalla del producto y no puede caerse
 * porque la API tarde: sin datos enseña el panel de arranque, que sigue siendo
 * navegable y sigue invitando a empezar el Ritual.
 */
export const fotoDelPanel = cache(async (): Promise<FotoDelPanel> => {
  const quien = await quienEntra();
  if (!quien) {
    // Puede ser "no hay sesión" o "hay sesión sin empresa". Se distinguen en la
    // página; aquí las dos producen el mismo panel de arranque.
    return VACIA;
  }

  const [foto, estado] = await Promise.all([
    pedir(`/onboarding/ritual`, quien.userEmail, quien.tenantSlug),
    pedir(`/onboarding/_status`, quien.userEmail, quien.tenantSlug),
  ]);

  const ritual = ritualEnPanel(foto as never);

  return {
    userEmail: quien.userEmail,
    tenantSlug: quien.tenantSlug,
    // El nombre de la sesión manda; si no vino, NO se cae al slug. Un slug con
    // su huella hexadecimal pegada (`taqueria-regia-mg34yjj6`) no es el nombre
    // de nadie, y verlo en el encabezado de su propia empresa se lee como que
    // el producto no sabe quién es.
    tenantName: quien.tenantName,
    sinEmpresa: false,
    ritual,
    pasos: pasosDelRitual(estado),
    senales: senalesDelRitual(ritual),
    ritualNoDisponible: foto === null,
  };
});

/** Las señales del Ritual, que es lo único que necesita el shell. */
export const senalesDelPanel = cache(async (): Promise<SenalesDelRitual | null> => {
  return (await fotoDelPanel()).senales;
});

// ════════════════════════════════════════════════════════════════════════════

function baseDeLaApi(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3100';
}

/**
 * Un viaje a la API que NUNCA revienta la pantalla.
 *
 * Cualquier fallo —la API caída, un plazo agotado, un cuerpo que no es JSON—
 * termina en `null`, y `null` el panel lo sabe contar: enseña lo que sí tiene y
 * dice que no pudo leer el avance. Un 500 en la cara de alguien que sólo quiso
 * ver su panel es peor que un panel incompleto.
 *
 * 6 segundos: ninguno de estos dos endpoints llama al modelo —`GET /ritual`
 * está documentado como "sin gastar un token" y `_status` es una constante—,
 * así que si tardan más de eso es que algo está mal y esperar no lo arregla.
 */
async function pedir(ruta: string, userEmail: string, tenantSlug: string): Promise<unknown> {
  try {
    const cabeceras: Record<string, string> = {
      'content-type': 'application/json',
      [HEADER.userEmail]: userEmail,
      [HEADER.tenantSlug]: tenantSlug,
    };

    const secreto = process.env.PROXY_SECRET;
    if (secreto) cabeceras[HEADER.proxySecret] = secreto;

    const r = await fetch(`${baseDeLaApi()}${ruta}`, {
      headers: cabeceras,
      cache: 'no-store',
      signal: AbortSignal.timeout(6_000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
