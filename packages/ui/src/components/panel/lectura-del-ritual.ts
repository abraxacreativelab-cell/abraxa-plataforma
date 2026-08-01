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
      href: '/ritual',
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
