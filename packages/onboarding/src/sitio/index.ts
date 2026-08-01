/**
 * ════════════════════════════════════════════════════════════════════════════
 *  «Pégame tu página y te ahorro preguntas.»
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es lo que más acelera el embudo, y también lo único del Ritual que sale a
 *  internet. Los tres archivos de al lado son las tres mitades del trabajo:
 *
 *    url.ts      qué se puede pedir (y las evasiones de SSRF, probadas)
 *    leer.ts     bajarlo sin colgarse y sin seguir una redirección a la red de adentro
 *    extraer.ts  qué dice, según el MODELO y no según una heurística frágil
 *
 *  Aquí sólo se orquestan y se redacta lo que el agente dice. Y esa redacción
 *  es la mitad del valor: **ningún camino de aquí termina en un error**. Ni la
 *  página que no existe, ni la SPA vacía, ni el Instagram, ni el modelo que se
 *  cayó. Todos terminan en una frase que suena a persona y en la entrevista
 *  siguiendo su curso.
 */
import type { TenantContext } from '@abraxa/db';
import { log } from '../logger';
import type { LecturaDelSitio, PropuestaDelSitio } from '../types';
import { extraerDeLaPagina } from './extraer';
import { leerPagina, type FalloDeLectura } from './leer';
import { mensajeDeRechazo, revisarUrl } from './url';

export {
  clasificarEnlace,
  esHostPrivado,
  esIpv4Privada,
  esIpv6Privada,
  mensajeDeRechazo,
  normalizarUrl,
  revisarUrl,
  type Clasificacion,
  type MotivoRechazo,
  type Revision,
} from './url';

export {
  decodificar,
  hayTextoUtil,
  leerPagina,
  paraElModelo,
  textoDe,
  tituloDe,
  type FalloDeLectura,
  type ResultadoDeLectura,
} from './leer';

export {
  comoLoDiriaEl,
  extraerDeLaPagina,
  jsonDeLaRespuesta,
  propuestasDe,
} from './extraer';

/**
 * "instagram" → "Instagram".
 *
 * Con `noUncheckedIndexedAccess`, `red[0]` es `string | undefined` aunque la
 * cadena venga de una tabla de constantes no vacías. `.slice(0, 1)` devuelve
 * `string` siempre y dice lo mismo sin un `!`.
 */
function conMayuscula(texto: string): string {
  return texto.slice(0, 1).toUpperCase() + texto.slice(1);
}

/**
 * Lo que el agente dice cuando el enlace es un perfil y no una página.
 *
 * Instagram y Facebook le contestan a un servidor con un muro de inicio de
 * sesión: pedirlo no da nada. Pero el handle SÍ es un dato bueno —es un canal
 * suyo, y muchas veces su nombre comercial— así que se toma, se dice con
 * naturalidad y se sigue. Fallar aquí sería fallar con la mitad de los
 * invitados, que es lo que la gente tiene en vez de página web.
 */
function mensajeDeRedSocial(red: string | null, handle: string | null): string {
  const nombre = red ? conMayuscula(red) : 'esa red';

  if (!handle) {
    return `Vi que me pasaste tu ${nombre}. Desde aquí no alcanzo a leer lo de adentro, así que ` +
      'mejor cuéntamelo tú en dos líneas y vamos rapidísimo.';
  }

  return (
    `Perfecto, ${handle} en ${nombre}. Ya lo anoté como uno de tus canales. Lo de adentro no lo ` +
    'alcanzo a leer desde aquí, así que el resto me lo cuentas tú — son cuatro toques.'
  );
}

/**
 * Lee lo que sea que haya pegado y devuelve propuestas que él pueda corregir.
 *
 * Nunca lanza y nunca devuelve un error de pantalla. `sirvio: false` significa
 * «no saqué nada», que es un resultado normal y trae su propia frase.
 */
export async function leerSuSitio(ctx: TenantContext, crudo: string): Promise<LecturaDelSitio> {
  const revision = revisarUrl(crudo);

  if (!revision.ok) {
    return {
      url: crudo.trim().slice(0, 200),
      tipo: 'sitio',
      handle: null,
      red: null,
      sirvio: false,
      propuestas: [],
      mensaje: mensajeDeRechazo(revision.motivo),
    };
  }

  // ── Un perfil de red social ───────────────────────────────────────────────
  if (revision.tipo === 'red-social') {
    const propuestas: PropuestaDelSitio[] = revision.red
      ? [
          {
            clave: 'canales',
            etiqueta: 'Por dónde le escriben',
            valor: conMayuscula(revision.red),
          },
        ]
      : [];

    return {
      url: revision.url.href,
      tipo: 'red-social',
      handle: revision.handle,
      red: revision.red,
      // El canal sí es un dato bueno y confirmado por él, así que cuenta como
      // algo que sí sirvió aunque no se haya leído una sola línea de la página.
      sirvio: propuestas.length > 0,
      propuestas,
      mensaje: mensajeDeRedSocial(revision.red, revision.handle),
    };
  }

  // ── Una página de verdad ──────────────────────────────────────────────────
  const lectura = await leerPagina(revision);

  if (!lectura.ok) {
    log.info(`no se pudo leer la página del invitado (${lectura.fallo}).`);
    return {
      url: revision.url.href,
      tipo: 'sitio',
      handle: null,
      red: null,
      sirvio: false,
      propuestas: [],
      mensaje: DISCULPAS[lectura.fallo],
    };
  }

  const propuestas = await extraerDeLaPagina(ctx, lectura.texto);

  if (propuestas.length === 0) {
    return {
      url: lectura.url,
      tipo: 'sitio',
      handle: null,
      red: null,
      sirvio: false,
      propuestas: [],
      mensaje:
        'Abrí tu página pero no saqué nada que me sirva de tu negocio. Sin bronca: me lo cuentas ' +
        'tú y son cuatro toques.',
    };
  }

  return {
    url: lectura.url,
    tipo: 'sitio',
    handle: null,
    red: null,
    sirvio: true,
    propuestas,
    mensaje:
      `Ya la leí${lectura.titulo ? ` — "${lectura.titulo}"` : ''}. Esto es lo que entendí de tu ` +
      'negocio. **Revísalo y corrige lo que esté mal**: sólo lo doy por bueno si tú lo confirmas.',
  };
}

/**
 * Lo que se dice cuando no se pudo leer, por cada motivo.
 *
 * Ninguna de estas frases dice «error», ninguna culpa al invitado y las cuatro
 * terminan ofreciendo el camino normal. Una página que no se deja leer no es un
 * problema suyo, y sobre todo no es un problema: son treinta segundos de
 * botones.
 */
const DISCULPAS: Record<FalloDeLectura, string> = {
  rechazada:
    'Esa dirección no la puedo abrir desde aquí. Cuéntame tú de tu negocio y seguimos igual de rápido.',
  'sin-respuesta':
    'Tu página no me contestó ahorita. Puede ser cosa del momento; da igual, cuéntame tú y avanzamos.',
  'no-es-pagina':
    'Eso que me pasaste no es una página que yo pueda leer. Cuéntame tú y en cuatro toques ya tienes mapa.',
  // La más común de todas, y la que más importa que suene bien: Framer, Wix y
  // Squarespace pintan todo en el navegador y desde aquí se ven en blanco.
  'sin-texto':
    'Tu página se arma en el navegador y desde acá la veo en blanco — me pasa con muchas páginas ' +
    'modernas, no es tuyo. Mejor cuéntame tú: son cuatro toques.',
};
