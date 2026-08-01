/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Lectura del Ritual — todo lo que el panel DECIDE, sin pintar nada
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Está separado del componente a propósito. Lo que hay que poder verificar del
 *  panel no es el HTML, es el criterio: qué le decimos al invitado según en qué
 *  punto va, y que nunca le digamos algo que no sea verdad. Eso es lógica pura y
 *  se prueba sin renderizar.
 *
 *  Ni un dato de aquí se inventa: todo viene de `GET /onboarding/ritual` y
 *  `GET /onboarding/_status` (H7), o no se muestra.
 */
import type { SenalesDelRitual } from '../nav/areas-de-arranque';

/** Una de las 7 fases, tal como las publica `GET /onboarding/_status`. */
export interface PasoDelRitual {
  fase: string;
  titulo: string;
  promesa: string;
}

/** La foto del Ritual, recortada a lo que el panel necesita. */
export interface RitualEnPanel {
  agente: string | null;
  /** Fases CERRADAS. Es `vista.faseIndice`, 0-based. */
  faseIndice: number;
  fasesTotales: number;
  /** 0–100, por fases cerradas. No puede retroceder. */
  progreso: number;
  tituloDeFase: string;
  /** `'activa' | 'pausada' | 'completada'` según H7. */
  status: string;
  turnos: number;
  /** `true` si nunca ha empezado. */
  nuevo: boolean;
  /** Lo que el agente ya sabe, en frases suyas. Sale de `memoria`. */
  loQueYaSabe: string[];
  /** Qué le falta a la fase actual para cerrar. */
  faltante: string[];
}

export type EstadoDelPaso = 'cerrada' | 'actual' | 'pendiente';

export interface HitoDelRitual extends PasoDelRitual {
  estado: EstadoDelPaso;
}

/**
 * Las 7 fases con su estado. Es el mapa que convierte «me faltan preguntas» en
 * «me faltan cinco cosas y ya sé cuáles»: la ansiedad de un cuestionario sin
 * final es exactamente lo que hace que el invitado se caiga a la mitad.
 */
export function hitosDelRitual(
  pasos: readonly PasoDelRitual[],
  ritual: RitualEnPanel | null,
): HitoDelRitual[] {
  const cerradas = ritual?.status === 'completada' ? pasos.length : (ritual?.faseIndice ?? 0);

  return pasos.map((p, i) => ({
    ...p,
    estado: i < cerradas ? 'cerrada' : i === cerradas ? 'actual' : 'pendiente',
  }));
}

export interface LlamadaDelPanel {
  /** El encabezado de la tarjeta del Ritual. */
  titulo: string;
  /** Una línea que explica qué sigue. */
  texto: string;
  /** El texto del botón. */
  boton: string;
  /** A dónde lleva. Siempre el Ritual: es la única acción del panel. */
  href: string;
}

/**
 * Qué le decimos y qué le ofrecemos, según en qué punto va.
 *
 * Cuatro casos y ninguno más, porque son los cuatro estados reales que puede
 * tener una sesión del Ritual: no existe, va a medias, está pausada, terminó.
 */
export function llamadaDelPanel(
  ritual: RitualEnPanel | null,
  siguiente: HitoDelRitual | null,
): LlamadaDelPanel {
  const quien = nombreDelAgente(ritual);

  if (!ritual || ritual.nuevo) {
    return {
      titulo: 'Tu Ritual de Fundación',
      texto:
        'Siete conversaciones cortas con tu agente y tu negocio queda montado aquí dentro. ' +
        'La primera es ponerle nombre.',
      boton: 'Empezar',
      href: '/ritual',
    };
  }

  if (ritual.status === 'completada') {
    return {
      titulo: 'Tu Ritual está completo',
      texto: `${quien} ya conoce tu negocio de punta a punta. Tu Mapa de Negocio está listo.`,
      boton: 'Ver tu Mapa de Negocio',
      // A `/mapa`, no a `/ritual`. El botón se llama «Ver tu Mapa de Negocio» y
      // llevaba de vuelta a la entrevista que el emprendedor ACABA de terminar
      // —el único enlace del panel que prometía una cosa y hacía otra—. El mapa
      // es la pantalla de H11 y desde el panel no había forma de llegar a ella.
      href: '/mapa',
    };
  }

  const faltaConcreta = ritual.faltante[0];
  const proxima = siguiente
    ? `Sigue «${siguiente.titulo}»: ${siguiente.promesa}`
    : `Vas en «${ritual.tituloDeFase}».`;

  return {
    titulo:
      ritual.status === 'pausada' ? `${quien} te está esperando` : `Sigue donde lo dejaste`,
    texto: faltaConcreta ? `${proxima} Falta ${faltaConcreta.toLowerCase()}.` : proxima,
    boton: `Seguir con ${quien}`,
    href: '/ritual',
  };
}

/** El nombre del agente, o una forma que no suena a hueco. */
export function nombreDelAgente(ritual: RitualEnPanel | null): string {
  const n = ritual?.agente?.trim();
  return n && n.length > 0 ? n : 'tu agente';
}

/**
 * Las frases que el agente ya extrajo, sacadas de `memoria`.
 *
 * `memoria` es el mensaje de regreso de H7 y trae dentro un bloque de viñetas
 * («· Te dedicas a …»). Se leen esas viñetas y ya: son frases que el agente
 * escribió a partir de lo que el emprendedor dijo con sus palabras, así que son
 * lo más real que el panel puede enseñar el primer día.
 *
 * Si el formato cambia, esto devuelve una lista vacía y el panel enseña otra
 * cosa. Nunca inventa una frase ni pinta la memoria cruda.
 */
export function loQueYaSabe(memoria: string | null | undefined, maximo = 4): string[] {
  if (!memoria) return [];

  return memoria
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('·'))
    .map((l) => l.replace(/^·\s*/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, maximo);
}

// ════════════════════════════════════════════════════════════════════════════
// De la respuesta de H7 a lo que el panel necesita
// ════════════════════════════════════════════════════════════════════════════

/**
 * La foto que devuelve `GET /onboarding/ritual`, recortada a lo que el panel
 * lee. Se declara aquí y NO se importa de `@abraxa/onboarding` a propósito: ese
 * paquete arrastra Express y el cliente de la base, y esto corre en el
 * navegador. Es el mismo criterio —y el mismo comentario— que ya tomó H7 en
 * `(onboarding)/ritual/lib/tipos.ts`.
 *
 * Todo opcional y todo `unknown`-tolerante: si la API cambia de forma, el panel
 * enseña menos, no revienta.
 */
export interface FotoDelRitual {
  vista?: {
    faseIndice?: number;
    fasesTotales?: number;
    progreso?: number;
    tituloDeFase?: string;
    status?: string;
    agente?: string | null;
    turnos?: number;
    faltante?: string[];
  } | null;
  memoria?: string | null;
  nuevo?: boolean;
}

/**
 * La foto de H7, convertida en lo que pinta el panel.
 *
 * Es lo único que traduce entre los dos contratos, y por eso es lo que hay que
 * poder probar: cada `??` de aquí es una pantalla que NO se rompe el día que la
 * API conteste algo raro.
 *
 * `null` entra y `null` sale — que el panel lee como "todavía no empieza su
 * Ritual", el estado más conservador y el único que no le promete a nadie un
 * avance que no tiene.
 */
export function ritualEnPanel(foto: FotoDelRitual | null | undefined): RitualEnPanel | null {
  if (!foto) return null;

  const v = foto.vista ?? {};
  const fasesTotales = enteroPositivo(v.fasesTotales) ?? 7;
  // El índice se recorta al total: un `faseIndice` mayor que `fasesTotales`
  // pintaría «Llevas 9 de 7 fases», que es la clase de detalle que hace dudar
  // de todos los demás números de la pantalla.
  const faseIndice = Math.min(enteroPositivo(v.faseIndice) ?? 0, fasesTotales);

  return {
    agente: cadena(v.agente),
    faseIndice,
    fasesTotales,
    // El progreso se RECALCULA por fases cerradas en vez de creerle al de la
    // API. Son la misma cuenta (`progresoDe()` en H7), pero así el anillo y el
    // «llevas X de 7» no se pueden contradecir nunca en pantalla.
    progreso:
      v.status === 'completada' ? 100 : Math.round((faseIndice / Math.max(fasesTotales, 1)) * 100),
    tituloDeFase: cadena(v.tituloDeFase) ?? '',
    status: cadena(v.status) ?? 'activa',
    turnos: enteroPositivo(v.turnos) ?? 0,
    // `nuevo` de la API manda; si no viene, se deduce de que no haya turnos.
    nuevo: typeof foto.nuevo === 'boolean' ? foto.nuevo : (enteroPositivo(v.turnos) ?? 0) === 0,
    loQueYaSabe: loQueYaSabe(foto.memoria),
    faltante: Array.isArray(v.faltante) ? v.faltante.filter((f) => typeof f === 'string') : [],
  };
}

/**
 * Las señales que abren áreas, sacadas de la misma foto.
 *
 * Existe para que el shell y el panel lean el Ritual UNA vez y no dos: la barra
 * lateral y el mosaico tienen que coincidir en qué está abierto, y la única
 * forma de garantizarlo es que la cuenta salga del mismo sitio.
 */
export function senalesDelRitual(ritual: RitualEnPanel | null): SenalesDelRitual | null {
  if (!ritual) return null;
  return {
    faseIndice: ritual.faseIndice,
    fasesTotales: ritual.fasesTotales,
    completado: ritual.status === 'completada',
    agente: ritual.agente,
  };
}

/** Las 7 fichas de `GET /onboarding/_status`, con lo que el panel necesita. */
export function pasosDelRitual(datos: unknown): PasoDelRitual[] {
  const fases = (datos as { fases?: unknown })?.fases;
  if (!Array.isArray(fases)) return [];

  return fases
    .map((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      const fase = cadena(o.fase);
      const titulo = cadena(o.titulo);
      if (!fase || !titulo) return null;
      return { fase, titulo, promesa: cadena(o.promesa) ?? '' } satisfies PasoDelRitual;
    })
    .filter((p): p is PasoDelRitual => p !== null);
}

function cadena(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function enteroPositivo(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/**
 * Cuántas áreas abre la SIGUIENTE fase. Es el número que convierte «contesta
 * más preguntas» en «contesta esto y se abre Dirección».
 */
export function areasQueAbreLaSiguienteFase(
  catalogo: readonly { slug: string; label: string; fasesQueNecesita: number; construida: boolean }[],
  ritual: RitualEnPanel | null,
): string[] {
  const cerradas = ritual?.status === 'completada' ? Number.POSITIVE_INFINITY : (ritual?.faseIndice ?? 0);
  if (!Number.isFinite(cerradas)) return [];

  return catalogo
    .filter((a) => a.construida && a.fasesQueNecesita === cerradas + 1)
    .map((a) => a.label);
}
