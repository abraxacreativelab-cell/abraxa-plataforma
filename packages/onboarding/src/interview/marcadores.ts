/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los marcadores — el canal lateral entre el modelo y la máquina de estados.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es el patrón más reusable de GARDEN (extensions/abraxa-bookkeeper/
 *  state-machine.ts:113-160): el modelo escribe su respuesta al emprendedor y
 *  además intercala marcadores en corchetes que el código parsea y BORRA antes
 *  de mostrar el mensaje. Así se extraen datos estructurados sin partir la
 *  conversación en dos llamadas ni pedirle JSON a un modelo que está siendo
 *  cálido con una persona.
 *
 *  ── Los dos arreglos sobre el original ────────────────────────────────────
 *
 *  1. UNA SOLA FUENTE DE VERDAD. En GARDEN la lista de marcadores está escrita
 *     dos veces —una en `parseTransitionSignals` y otra en
 *     `stripSignalMarkers`— y las dos a mano. Agregar un marcador y olvidar la
 *     segunda lista significa que ese corchete aparece EN LA CARA del cliente.
 *     Aquí las dos derivan de `MARCADORES`, así que no se pueden desincronizar.
 *
 *  2. EL BARRIDO DE DESCONOCIDOS. Un modelo inventa marcadores; es lo que
 *     hacen. Después de limpiar los conocidos se pasa una escoba por cualquier
 *     `[PALABRA_EN_MAYÚSCULAS:…]` que haya quedado y se registra en el log. El
 *     criterio #5 del handoff dice "los marcadores NUNCA se ven en pantalla" —
 *     no "los marcadores que anticipamos".
 */
import { log } from '../logger';
import type { Fase } from '../types';
import { FASES } from './fases';

// ════════════════════════════════════════════════════════════════════════════
// La gramática
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los nombres de marcador que entiende el Ritual. La lista es la fuente de
 * verdad del parser Y del limpiador.
 *
 * Se documentan en el prompt (interview/guion.ts) con la misma redacción.
 */
export const MARCADORES = [
  'FASE_COMPLETA',
  'DATO',
  'LISTA',
  'PASO',
  'DOLOR',
  'HITO',
  'AREA',
  'PAUSA',
  'MAPA_LISTO',
] as const;

export type NombreMarcador = (typeof MARCADORES)[number];

/**
 * Un marcador con o sin argumentos: `[PAUSA]`, `[DATO:giro=taller]`.
 *
 * `[^\]]*` a propósito y no algo más estricto: un marcador MALFORMADO también
 * tiene que morir. Uno que el parser no entiende y el limpiador no borra es
 * exactamente el corchete que termina en la pantalla del cliente.
 */
function patronDe(nombre: string): RegExp {
  return new RegExp(`\\[${nombre}(?::[^\\]]*)?\\]`, 'g');
}

/** Escoba final: cualquier `[COSA_ASI:…]` que el modelo se haya inventado. */
const PATRON_DESCONOCIDO = /\[[A-Z][A-Z0-9_]{2,}(?::[^\]]*)?\]/g;

// ════════════════════════════════════════════════════════════════════════════
// Lo que el parser devuelve
// ════════════════════════════════════════════════════════════════════════════

export interface SenalesDelTurno {
  /** El modelo PIDE cerrar esta fase. Es una petición, no una orden: quien
   *  decide es `cierre.ts`. Ver el criterio #6. */
  faseCompleta?: Fase;
  /** `clave=valor` de campos simples. */
  datos: Record<string, string>;
  /** `clave=valor` que se acumulan en un arreglo (canales, herramientas). */
  listas: Record<string, string[]>;
  /** Pasos del recorrido del cliente: `[PASO:nombre|cómo lo hace hoy]`. */
  pasos: Array<{ nombre: string; como?: string }>;
  /** `[DOLOR:texto|areaSlug]` */
  dolores: Array<{ texto: string; areaSlug?: string }>;
  /**
   * `[HITO:areaSlug|título|detalle|origen]`
   *
   * `origen` es opcional. Si no viene, lo decide la máquina a partir de la fase
   * en curso: un hito que nace en la fase 4 es del abogado del diablo salvo que
   * el modelo diga explícitamente que lo pidió el emprendedor.
   */
  hitos: Array<{ areaSlug: string; titulo: string; detalle?: string; origen?: string }>;
  /** `[AREA:slug|estado|razón]` */
  areas: Array<{ slug: string; estado: string; razon?: string }>;
  pausa: boolean;
  mapaListo: boolean;
}

/**
 * Se deriva de `FASES`, no se reescribe.
 *
 * Sería el mismo error que el de las dos listas de marcadores de GARDEN, sólo
 * que con las fases: agregar una en `fases.ts` y olvidarla aquí haría que el
 * modelo pudiera pedir cerrarla y el parser la tirara en silencio — un bug que
 * se ve como "el agente se atoró".
 */
const FASES_VALIDAS = new Set<string>(FASES);

/** Argumentos de un marcador, ya partidos por `|` y recortados. */
function partes(argumento: string): string[] {
  return argumento
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Todas las apariciones de un marcador, con su argumento crudo. */
function capturar(texto: string, nombre: NombreMarcador): string[] {
  const re = new RegExp(`\\[${nombre}(?::([^\\]]*))?\\]`, 'g');
  const encontrados: string[] = [];
  for (const m of texto.matchAll(re)) encontrados.push((m[1] ?? '').trim());
  return encontrados;
}

/** Parte `clave=valor` respetando los `=` que vengan dentro del valor. */
function claveValor(argumento: string): [string, string] | null {
  const i = argumento.indexOf('=');
  if (i <= 0) return null;
  const clave = argumento.slice(0, i).trim();
  const valor = argumento.slice(i + 1).trim();
  if (!clave || !valor) return null;
  return [clave, valor];
}

// ════════════════════════════════════════════════════════════════════════════
// Parser
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lee los marcadores de una respuesta del modelo.
 *
 * No valida contra el estado del negocio ni decide nada: eso es de la máquina.
 * Aquí sólo se traduce texto a estructura, y lo que venga malformado se ignora
 * en silencio — un marcador roto no puede tumbar un turno que el cliente ya
 * está esperando.
 */
export function leerMarcadores(texto: string): SenalesDelTurno {
  const senales: SenalesDelTurno = {
    datos: {},
    listas: {},
    pasos: [],
    dolores: [],
    hitos: [],
    areas: [],
    pausa: false,
    mapaListo: false,
  };

  for (const arg of capturar(texto, 'FASE_COMPLETA')) {
    if (FASES_VALIDAS.has(arg)) senales.faseCompleta = arg as Fase;
  }

  for (const arg of capturar(texto, 'DATO')) {
    const kv = claveValor(arg);
    if (kv) senales.datos[kv[0]] = kv[1];
  }

  for (const arg of capturar(texto, 'LISTA')) {
    const kv = claveValor(arg);
    if (!kv) continue;
    const [clave, valor] = kv;
    const acumulado = senales.listas[clave] ?? [];
    // Un `[LISTA:canales=whatsapp, instagram]` es una sola llamada con dos
    // valores. Partirlo aquí evita depender de que el modelo emita un marcador
    // por elemento, que es justo lo que no hace de forma consistente.
    for (const v of valor.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!acumulado.includes(v)) acumulado.push(v);
    }
    senales.listas[clave] = acumulado;
  }

  for (const arg of capturar(texto, 'PASO')) {
    const p = partes(arg);
    const nombre = p[0];
    if (!nombre) continue;
    const como = p[1];
    senales.pasos.push(como ? { nombre, como } : { nombre });
  }

  for (const arg of capturar(texto, 'DOLOR')) {
    const p = partes(arg);
    const texto0 = p[0];
    if (!texto0) continue;
    const areaSlug = p[1];
    senales.dolores.push(areaSlug ? { texto: texto0, areaSlug } : { texto: texto0 });
  }

  for (const arg of capturar(texto, 'HITO')) {
    const p = partes(arg);
    const areaSlug = p[0];
    const titulo = p[1];
    if (!areaSlug || !titulo) continue;
    const hito: { areaSlug: string; titulo: string; detalle?: string; origen?: string } = {
      areaSlug,
      titulo,
    };
    if (p[2]) hito.detalle = p[2];
    if (p[3]) hito.origen = p[3];
    senales.hitos.push(hito);
  }

  for (const arg of capturar(texto, 'AREA')) {
    const p = partes(arg);
    const slug = p[0];
    const estado = p[1];
    if (!slug || !estado) continue;
    const razon = p[2];
    senales.areas.push(razon ? { slug, estado, razon } : { slug, estado });
  }

  if (capturar(texto, 'PAUSA').length > 0) senales.pausa = true;
  if (capturar(texto, 'MAPA_LISTO').length > 0) senales.mapaListo = true;

  return senales;
}

// ════════════════════════════════════════════════════════════════════════════
// Limpiador
// ════════════════════════════════════════════════════════════════════════════

/**
 * El texto que de verdad ve el emprendedor.
 *
 * Es la última línea de defensa del criterio #5. Se corre SIEMPRE antes de
 * guardar en el transcript y antes de responder: lo que se persiste es
 * exactamente lo que se vio, para que reanudar mañana no le reviva marcadores
 * al modelo dentro de su propio historial.
 */
export function limpiarMarcadores(texto: string): string {
  let limpio = texto;
  for (const nombre of MARCADORES) limpio = limpio.replace(patronDe(nombre), '');

  // La escoba. Si algo cae aquí es que el modelo se inventó un marcador — se
  // borra igual y se deja dicho, porque es señal de que el guion necesita
  // ajuste, no de que el cliente tenga que ver corchetes.
  const inventados = limpio.match(PATRON_DESCONOCIDO);
  if (inventados) {
    log.warn(`el modelo inventó marcadores y se barrieron: ${inventados.join(' ')}`);
    limpio = limpio.replace(PATRON_DESCONOCIDO, '');
  }

  return limpio
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * `true` si al texto todavía le queda algún marcador.
 *
 * Lo usan las pruebas y el guardia de la ruta: es más barato afirmar esto que
 * revisar a mano cada respuesta.
 */
export function tieneMarcadores(texto: string): boolean {
  PATRON_DESCONOCIDO.lastIndex = 0;
  return PATRON_DESCONOCIDO.test(texto);
}
