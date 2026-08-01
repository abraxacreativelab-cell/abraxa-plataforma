/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Qué acepta cada modelo. Por MODELO, no por proveedor.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Este archivo existe por una trampa concreta que tumba producción en la
 *  primera llamada:
 *
 *    `sales`, `service` y `social` corren en claude-haiku-4-5 por defecto.
 *    Haiku 4.5 devuelve **400** si le mandas `output_config.effort`, y no
 *    entiende el pensamiento adaptativo (`thinking: {type:'adaptive'}`) — eso
 *    llegó con la generación 4.6. Un adaptador que arme el cuerpo igual para
 *    todos los modelos rompe los tres sub-agentes de golpe.
 *
 *  Y una segunda, más callada:
 *
 *    En Sonnet 5 el pensamiento viene ENCENDIDO por omisión. Si nadie lo apaga,
 *    cada mensaje de un cliente final paga tokens de razonamiento que nadie
 *    pidió, y `max_tokens` cubre pensamiento + texto, así que la respuesta
 *    además sale truncada. No hay error: sólo respuestas peores y más caras.
 *
 *  Por eso las banderas viven en una tabla y no en `if (model.includes(...))`.
 *
 *  ── El mínimo cacheable ────────────────────────────────────────────────────
 *
 *  Debajo del mínimo, el caché de prompt NO se crea. Sin error, sin aviso: la
 *  respuesta llega igual y la factura es otra. Dos cosas que conviene tener
 *  claras antes de "arreglarlo" alargando prompts:
 *
 *  1. El mínimo aplica al PREFIJO CACHEABLE COMPLETO. El orden de render es
 *     `tools → system → messages`, así que las definiciones de tools cuentan.
 *     Un sub-agente con seis tools puede pasar el mínimo sin tocar el prompt.
 *
 *  2. El mínimo NO crece con la generación. Va de 512 en Opus 5 a 4,096 en
 *     Haiku 4.5 y Opus 4.6. No se puede inferir del nombre del modelo; hay que
 *     tabularlo.
 *
 *  Fallar el caché no "triplica" el costo: pierde el ahorro de ~90%. Sin caché
 *  pagas 1.0× de input en cada llamada; con caché pagas 1.25× una vez y 0.1×
 *  las siguientes. La llamada repetida termina costando ~10× lo que costaría
 *  cacheada. La diferencia importa para saber qué buscar cuando la factura no
 *  cuadra.
 */
import type { ProviderName } from '@abraxa/db';

/** Cómo se le pide a un modelo que piense (o que no). */
export type ThinkingStyle =
  /** Generación 4.6+: `{type:'adaptive'}` / `{type:'disabled'}`. */
  | 'adaptive'
  /** Generación previa: `{type:'enabled', budget_tokens:N}`. */
  | 'budget'
  /** No acepta el parámetro. Mandarlo es un 400. */
  | 'none';

export interface ModelCapabilities {
  /** Acepta `output_config.effort`. En Haiku 4.5 es 400. */
  effort: boolean;
  thinking: ThinkingStyle;
  /** El pensamiento viene encendido si NO se manda el parámetro. */
  thinkingOnByDefault: boolean;
  /** Tokens mínimos del prefijo (tools + system) para que el caché exista. */
  cacheMinTokens: number;
  /** Acepta `cache_control: {ttl:'1h'}` además del TTL de 5 minutos. */
  cacheTtl1h: boolean;
  /** Ventana de contexto, en tokens. */
  contextWindow: number;
  /** Techo duro de tokens de salida. */
  maxOutputTokens: number;
  /** Sirve para la Batch API (−50%, asíncrono). */
  batch: boolean;
}

/**
 * Al 2026-07-30. Un modelo que no esté aquí no se usa a ciegas: `capsFor()`
 * devuelve un perfil conservador que no manda ningún parámetro opcional.
 * Preferimos una llamada sin optimizar a una llamada que revienta.
 */
const CATALOGO: Record<string, ModelCapabilities> = {
  'claude-opus-5': {
    effort: true,
    thinking: 'adaptive',
    thinkingOnByDefault: true,
    cacheMinTokens: 512,
    cacheTtl1h: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    batch: true,
  },
  'claude-opus-4-8': {
    effort: true,
    thinking: 'adaptive',
    thinkingOnByDefault: false,
    cacheMinTokens: 1024,
    cacheTtl1h: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    batch: true,
  },
  'claude-fable-5': {
    effort: true,
    // Fable 5 piensa siempre: mandar `{type:'disabled'}` es 400. El adaptador
    // no manda nada y deja que el modelo decida.
    thinking: 'none',
    thinkingOnByDefault: true,
    cacheMinTokens: 512,
    cacheTtl1h: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    batch: true,
  },
  'claude-sonnet-5': {
    effort: true,
    thinking: 'adaptive',
    // ⚠️ Encendido por omisión. Los sub-agentes lo apagan explícitamente.
    thinkingOnByDefault: true,
    cacheMinTokens: 1024,
    cacheTtl1h: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    batch: true,
  },
  'claude-sonnet-4-6': {
    effort: true,
    thinking: 'adaptive',
    thinkingOnByDefault: false,
    cacheMinTokens: 1024,
    cacheTtl1h: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    batch: true,
  },
  'claude-haiku-4-5': {
    // ⚠️ La trampa. `effort` aquí es 400.
    effort: false,
    thinking: 'budget',
    thinkingOnByDefault: false,
    // ⚠️ El mínimo más alto de todo el catálogo, en el modelo de más volumen.
    cacheMinTokens: 4096,
    cacheTtl1h: true,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    batch: true,
  },
};

/** Perfil de un modelo desconocido: no mandes nada opcional y no asumas caché. */
export const CAPS_CONSERVADORAS: ModelCapabilities = {
  effort: false,
  thinking: 'none',
  thinkingOnByDefault: false,
  // El mínimo más alto que conocemos: si el prefijo no llega a 4,096 no
  // prometemos caché. Fallar hacia "no cachea" es contarlo de más, nunca de
  // menos.
  cacheMinTokens: 4096,
  cacheTtl1h: false,
  contextWindow: 200_000,
  maxOutputTokens: 4096,
  batch: false,
};

/**
 * ── El dialecto de ids de cada proveedor ────────────────────────────────────
 *
 * Cada proveedor nombra al MISMO modelo de forma distinta, y mandarle el id del
 * otro es un 400 garantizado:
 *
 *   anthropic   `claude-haiku-4-5`             — sin prefijo, guiones
 *   openrouter  `anthropic/claude-haiku-4.5`   — `vendor/modelo`, puntos
 *   local       lo que el runtime propio use   — no lo conocemos, no opinamos
 *
 * `canonizarModelo` traduce un id al nombre del catálogo, o devuelve `null` si
 * el id NO PERTENECE al dialecto del proveedor. Ese `null` es el punto: antes,
 * `capsFor` hacía hit directo en `CATALOGO[model]` sin mirar el proveedor, así
 * que la pareja rota (`provider='openrouter'`, `model='claude-haiku-4-5'`)
 * respondía `esConocido() === true` y ninguna señal se encendía — hasta que
 * OpenRouter contestaba `400 not a valid model ID` en CADA mensaje de ese rol.
 *
 * `local` queda exento a propósito: el día que Santiago corra modelos propios
 * no sabemos si los va a nombrar `mi-llama` o `meta-llama/Llama-3-8B`, y
 * adivinarlo aquí sería inventar una regla para bloquear algo que todavía no
 * existe.
 */
export function canonizarModelo(model: string, provider: ProviderName): string | null {
  // Un id vacío o de puro espacio no es de nadie. Se ataja aquí y no más
  // abajo porque si no `''` pasaría el dialecto de Anthropic (no trae barra) y
  // `'x/'` el de OpenRouter (trae barra) — dos ids degenerados que ninguna capa
  // rechazaba y que el proveedor contesta con 400.
  const id = model.trim();
  if (id.length === 0) return null;

  const corte = id.indexOf('/');

  if (provider === 'openrouter') {
    // Sin `vendor/` no es un id de OpenRouter. Ni siquiera se busca.
    if (corte === -1) return null;
    // Y con la barra al principio o al final tampoco: `'/x'` no tiene vendor y
    // `'x/'` no tiene modelo.
    const vendor = id.slice(0, corte);
    const sinPrefijo = id.slice(corte + 1);
    if (vendor.length === 0 || sinPrefijo.length === 0) return null;
    // `claude-haiku-4.5` → `claude-haiku-4-5`
    return sinPrefijo.replace(/\./g, '-');
  }

  if (provider === 'local') return id;

  // Anthropic directo: un id con `vendor/` es de otro proveedor.
  return corte === -1 ? id : null;
}

/**
 * `true` si el id RESPETA el dialecto del proveedor, esté o no en el catálogo.
 *
 * Es la validación que usa la escritura de `app.agent_definitions`, y es MÁS
 * LAXA que `esConocido()` a propósito: `deepseek/deepseek-chat` no está en el
 * catálogo de capacidades y aun así es un id perfectamente válido de OpenRouter
 * —de hecho tiene fila de precio desde la migración 021—. Exigir `esConocido()`
 * para escribir una definición devolvería a H3 al problema que vino a matar:
 * estrenar un modelo requeriría un deploy.
 */
export function dialectoValido(model: string, provider: ProviderName): boolean {
  return canonizarModelo(model, provider) !== null;
}

/**
 * Capacidades de un modelo.
 *
 * Un id que no corresponde al dialecto del proveedor NO resuelve al catálogo:
 * cae al perfil conservador, que es lo que corresponde a algo de lo que no
 * sabemos nada.
 */
export function capsFor(model: string, provider: ProviderName = 'anthropic'): ModelCapabilities {
  const canon = canonizarModelo(model, provider);
  if (canon !== null) {
    const directo = CATALOGO[canon];
    if (directo) return directo;
  }
  return CAPS_CONSERVADORAS;
}

/**
 * `true` si el modelo está en el catálogo PARA ESE PROVEEDOR (no cayó al perfil
 * conservador).
 *
 * El proveedor no es decorativo: `esConocido('claude-haiku-4-5', 'openrouter')`
 * es `false`, porque ese id no existe en OpenRouter aunque el modelo sí.
 */
export function esConocido(model: string, provider: ProviderName = 'anthropic'): boolean {
  return capsFor(model, provider) !== CAPS_CONSERVADORAS;
}

/** Los modelos tabulados. Lo usan las pruebas y el chequeo de precios. */
export function modelosConocidos(): string[] {
  return Object.keys(CATALOGO);
}
