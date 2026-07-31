/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El evaluador de requisitos — PURO
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Recibe una lista de condiciones (que vino de la base) y una foto del negocio
 *  (que vino de la base), y dice si el área se abre. No consulta nada, no
 *  escribe nada, y por eso el criterio observable 5 del handoff —*"cambiar
 *  `requirements` en datos cambia el comportamiento sin desplegar"*— se puede
 *  verificar de verdad: la prueba le cambia el dato y el resultado cambia.
 *
 *  ── La decisión de fondo: qué se hace con un requisito que no se entiende ──
 *
 *  Un `{"type":"lo_que_sea"}` en la base puede llegar por tres vías: alguien
 *  escribió mal un UPDATE, el agente maestro propuso una condición que la
 *  plataforma todavía no sabe evaluar, o un despliegue viejo está leyendo datos
 *  nuevos.
 *
 *  Ignorarlo sería lo cómodo, y es exactamente lo que NO se hace: ignorar una
 *  condición la vuelve `true` por omisión y abre un área que nadie se ganó. La
 *  regla es la de `loadAreaGrants` de H2 con los permisos malformados, por la
 *  misma razón: **un requisito que no se entiende NO se cumple**. El área se
 *  queda cerrada, el candado lo dice con todas sus letras, y alguien lo arregla.
 *
 *  A diferencia de los permisos, aquí NO se lanza: un requisito roto de un área
 *  no puede tumbar el mapa entero, porque entonces un dato malo en Finanzas
 *  dejaría al emprendedor sin poder entrar a Ventas. Se degrada, y se ve.
 */
import {
  type Evaluation,
  type Progress,
  PROGRESS_VACIO,
  type Requirement,
  type RequirementCheck,
  type Signals,
  SIGNAL_KEYS,
  SIGNALS_CERO,
  TIPOS_CONOCIDOS,
} from './types';

// ════════════════════════════════════════════════════════════════════════════
// Lectura de lo que llega de la base
// ════════════════════════════════════════════════════════════════════════════

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Un entero >= 0, con default. `"3"` cuenta: PostgREST devuelve números, pero
 *  un `requirements` escrito a mano en un UPDATE puede traer texto. */
function entero(v: unknown, porDefecto: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : porDefecto;
}

/**
 * Estrecha un valor de la base a un `Requirement`, o devuelve `null` si no se
 * entiende. `null` NO es "se cumple": ver la cabecera.
 */
export function parseRequirement(raw: unknown): Requirement | null {
  if (!esObjeto(raw)) return null;

  const type = raw.type;
  if (typeof type !== 'string') return null;
  if (!(TIPOS_CONOCIDOS as readonly string[]).includes(type)) return null;

  switch (type) {
    case 'always':
    case 'manual':
    case 'pipeline_defined':
      return { type };

    case 'has_channel':
    case 'value_count':
    case 'document_count':
    case 'contact_count':
    case 'deal_won':
    case 'months_operating':
      // `min` ausente significa "al menos uno", que es lo que quiere decir
      // `{"type":"has_channel"}` leído en voz alta. Un `min: 0` explícito sí se
      // respeta, y es una condición que se cumple sola — a propósito.
      return { type, min: entero(raw.min, 1) };

    case 'declared': {
      const key = typeof raw.key === 'string' ? raw.key.trim() : '';
      return key ? { type, key } : null;
    }

    case 'any_of': {
      if (!Array.isArray(raw.of)) return null;
      const of = raw.of.map(parseRequirement);
      // Si UNA de las alternativas no se entiende, el `any_of` entero no se
      // entiende: aceptar las que sí se leyeron podría abrir el área por el
      // camino equivocado, que es justo lo que la alternativa rota impedía.
      if (of.some((r) => r === null)) return null;
      return of.length ? { type, of: of as Requirement[] } : null;
    }

    default:
      return null;
  }
}

/** La lista completa. Los elementos ilegibles se conservan como `null` para
 *  que el evaluador los cuente como incumplidos en vez de perderlos. */
export function parseRequirements(raw: unknown): Array<Requirement | null> {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseRequirement);
}

/** El `progress` de la fila, saneado. */
export function parseProgress(raw: unknown): Progress {
  if (!esObjeto(raw)) return { ...PROGRESS_VACIO, declared: {} };

  const declared: Record<string, boolean> = {};
  if (esObjeto(raw.declared)) {
    for (const [k, v] of Object.entries(raw.declared)) declared[k] = v === true;
  }

  const salida: Progress = { declared };
  if (esObjeto(raw.signals)) salida.signals = raw.signals as Partial<Signals>;
  if (typeof raw.checked_at === 'string') salida.checked_at = raw.checked_at;
  return salida;
}

/**
 * Las señales que llegan del RPC, saneadas a números.
 *
 * Se recorren las claves CONOCIDAS y no las que trae el objeto: una señal nueva
 * que la función de Postgres empiece a devolver antes de que este código la
 * entienda se ignora, en vez de colarse sin tipo hasta un evaluador que no sabe
 * qué hacer con ella.
 */
export function parseSignals(raw: unknown): Signals {
  if (!esObjeto(raw)) return { ...SIGNALS_CERO };
  const salida = { ...SIGNALS_CERO };
  for (const k of SIGNAL_KEYS) salida[k] = entero(raw[k], 0);
  return salida;
}

// ════════════════════════════════════════════════════════════════════════════
// La redacción del candado
// ════════════════════════════════════════════════════════════════════════════

/** Cómo se lee cada condición cuando TODAVÍA no se cumple. En segunda persona
 *  y en presente: es lo que él tiene que hacer, no una etiqueta de sistema. */
const PENDIENTE: Record<string, (n: number) => string> = {
  has_channel: (n) => (n === 1 ? 'conectas un canal' : `conectas ${n} canales`),
  pipeline_defined: () => 'defines tu embudo de ventas',
  value_count: (n) => (n === 1 ? 'defines un valor de tu negocio' : `defines ${n} valores de tu negocio`),
  document_count: (n) => (n === 1 ? 'cargas un documento' : `cargas ${n} documentos`),
  contact_count: (n) => (n === 1 ? 'tienes un contacto activo' : `tienes ${n} contactos activos`),
  deal_won: (n) => (n === 1 ? 'cierras tu primera venta en el sistema' : `cierras ${n} ventas en el sistema`),
  months_operating: (n) => (n === 1 ? 'cumples un mes de operación' : `cumples ${n} meses de operación`),
};

/** Las declaraciones que el emprendedor hace de su propio negocio. */
const DECLARACIONES: Record<string, string> = {
  va_a_contratar: 'nos dices que vas a contratar',
};

function etiquetaDeclarada(key: string): string {
  return DECLARACIONES[key] ?? `confirmas "${key.replace(/_/g, ' ')}"`;
}

/** El conteo que le toca a cada tipo. `null` si la condición no es de conteo. */
function conteo(req: Requirement, s: Signals): { current: number; needed: number } | null {
  switch (req.type) {
    case 'has_channel':
      return { current: s.channels_active, needed: req.min };
    case 'value_count':
      return { current: s.values_active, needed: req.min };
    case 'document_count':
      return { current: s.documents, needed: req.min };
    case 'contact_count':
      return { current: s.contacts_active, needed: req.min };
    case 'deal_won':
      return { current: s.deals_won, needed: req.min };
    case 'months_operating':
      return { current: s.months_operating, needed: req.min };
    case 'pipeline_defined':
      return { current: s.pipeline_stages, needed: 1 };
    default:
      return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// La evaluación
// ════════════════════════════════════════════════════════════════════════════

/** Una condición, resuelta. `req === null` es el requisito que no se entendió. */
function evaluarUno(req: Requirement | null, s: Signals, p: Progress): RequirementCheck {
  if (req === null) {
    // Se queda cerrada Y lo dice. Un candado que no explica nada es peor que
    // uno que dice "hay una condición que no entendemos": lo segundo se reporta.
    return {
      requirement: { type: 'manual' },
      met: false,
      progress: null,
      label: 'hay un requisito que este sistema no sabe leer (avísanos)',
    };
  }

  if (req.type === 'always') {
    return { requirement: req, met: true, progress: null, label: 'disponible desde el inicio' };
  }

  if (req.type === 'manual') {
    return { requirement: req, met: false, progress: null, label: 'la abres tú cuando quieras' };
  }

  if (req.type === 'declared') {
    const met = p.declared[req.key] === true;
    return { requirement: req, met, progress: null, label: etiquetaDeclarada(req.key) };
  }

  if (req.type === 'any_of') {
    const partes = req.of.map((r) => evaluarUno(r, s, p));
    const met = partes.some((x) => x.met);
    // El progreso del `any_of` es el del camino MÁS avanzado: si le falta un
    // documento o dos valores, la barra tiene que enseñar el más cerca, que es
    // por donde va a terminar entrando.
    const mejor = partes
      .filter((x) => x.progress)
      .map((x) => x.progress as { current: number; needed: number })
      .sort((a, b) => b.current / Math.max(b.needed, 1) - a.current / Math.max(a.needed, 1))[0];

    return {
      requirement: req,
      met,
      progress: mejor ?? null,
      label: partes.map((x) => x.label).join(' o '),
    };
  }

  const c = conteo(req, s);
  const met = c !== null && c.current >= c.needed;
  const necesita = c?.needed ?? 1;
  return {
    requirement: req,
    met,
    progress: c,
    label: (PENDIENTE[req.type] ?? (() => req.type))(necesita),
  };
}

/**
 * ¿Se abre el área?
 *
 * TODAS las condiciones tienen que cumplirse (`every`). Una lista VACÍA se
 * cumple —no hay nada que pedir— y eso es intencional: es lo que hace que un
 * área sembrada sin reglas quede disponible en vez de bloqueada para siempre.
 * Para "no se abre sola" existe `{"type":"manual"}`, que es explícito.
 */
export function evaluate(
  requirements: unknown,
  signals: Signals,
  progress: Progress = PROGRESS_VACIO,
): Evaluation {
  const lista = parseRequirements(requirements);
  const checks = lista.map((r) => evaluarUno(r, signals, progress));

  return {
    met: checks.every((c) => c.met),
    checks,
    missing: checks.filter((c) => !c.met).map((c) => c.label),
  };
}

/**
 * Cuánto del camino lleva, de 0 a 1. Es para la barra del candado, no para
 * decidir nada: la decisión es `met`.
 *
 * Una condición sin conteo (`declared`, `manual`) vale 0 o 1 y no a medias: no
 * existe media declaración.
 */
export function completionRatio(evaluation: Evaluation): number {
  if (!evaluation.checks.length) return 1;

  const suma = evaluation.checks.reduce((acc, c) => {
    if (c.met) return acc + 1;
    if (!c.progress || c.progress.needed <= 0) return acc;
    return acc + Math.min(c.progress.current / c.progress.needed, 1);
  }, 0);

  return Math.min(Math.max(suma / evaluation.checks.length, 0), 1);
}
