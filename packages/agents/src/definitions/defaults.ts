/**
 * Los agentes con los que nace un cliente.
 *
 * Cada emprendedor tiene un AGENTE MAESTRO al que él mismo le pone nombre en su
 * primer minuto en el producto (H7 lo hace con `upsertDefinition`), y debajo
 * unos sub-agentes por área que contestan a SUS clientes.
 *
 * Los prompts de aquí son el punto de partida, no el destino: en cuanto el
 * Ritual de Fundación descubre el giro y los números del negocio, H7 los
 * reescribe. Y el bloque de la bóveda se inyecta en cada mensaje, así que las
 * cifras nunca viven en este archivo.
 */
import { DEFAULT_MODEL_BY_ROLE } from '@abraxa/config';
import type { AgentRole, ProviderName } from '@abraxa/db';

export interface SemillaAgente {
  role: AgentRole;
  /** Nombre por defecto. El del maestro lo pisa el emprendedor en el bautizo. */
  name: string;
  provider: ProviderName;
  model: string;
  systemPrompt: string;
  tools: string[];
}

/**
 * Reglas de casa: aplican a todos los agentes de cara al cliente final.
 *
 * La primera línea no es adorno. Es la misma instrucción que en GARDEN
 * acompaña al bloque de la bóveda ("cítalas EXACTAS; no las inventes") y es lo
 * único que separa a un agente útil de uno que le promete a un cliente un
 * precio que su dueño nunca dio.
 */
const REGLAS_DE_CASA = `
REGLAS QUE NO SE ROMPEN
- Sobre precios, plazos, políticas y disponibilidad: cita ÚNICAMENTE lo que
  aparezca en el bloque de datos vigentes. Si un dato no está ahí, dilo con
  naturalidad y ofrece confirmarlo. Jamás lo inventes ni lo aproximes.
- Si la persona pide algo que no puedes resolver, o se molesta, o pide hablar
  con un humano: dilo claro y pasa la conversación. No improvises autoridad que
  no tienes.
- Habla como habla el negocio, no como un manual. Español de México, natural,
  sin formalidades de más y sin emojis salvo que el negocio los use.
- Respuestas cortas. Estás en un chat, no escribiendo un correo.
`.trim();

function conReglas(especifico: string): string {
  return `${especifico.trim()}\n\n${REGLAS_DE_CASA}`;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El proveedor por defecto es OPENROUTER. Decisión de Santiago, 2026-08-01.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Todo el tráfico del sistema sale por OpenRouter. Las llaves directas de
 * Anthropic quedan para el futuro: la capacidad se conserva en el código —el
 * adaptador y el dialecto de `anthropic` siguen enteros— pero NADA NACE
 * apuntando ahí.
 *
 * No es una preferencia: es lo que estaba tumbando el producto. Cada tenant
 * nuevo nacía con `provider: 'anthropic'` y NO existe `ANTHROPIC_API_KEY` (a
 * propósito), así que el PRIMER mensaje del Ritual de cada invitado moría con
 *
 *     502 PROVIDER_ERROR — "No hay llave para 'anthropic'"
 *
 * y no había override global: el proveedor sale exclusivamente de la fila del
 * agente, así que la única cura era editar la fila a mano, tenant por tenant.
 *
 * ── Por qué el modelo se TRADUCE y no se copia ──────────────────────────────
 *
 * Cambiar sólo `provider` y dejar el id sin prefijo produce exactamente la
 * combinación inválida que este carril ya cerró: `provider='openrouter'` con un
 * id de Anthropic es un 400 «not a valid model ID» del proveedor, a media
 * corrida y en la cara del cliente final. Cada proveedor nombra al mismo modelo
 * distinto, y ese par es UNA sola decisión:
 *
 *     anthropic   claude-haiku-4-5              sin prefijo, guiones
 *     openrouter  anthropic/claude-haiku-4.5    vendor/modelo, puntos
 *
 * `agent_definitions_provider_model_ck` (migración 027) lo impide a nivel de
 * base, y `dialectoValido()` lo impide en código. Esto lo respeta traduciendo.
 */
const A_OPENROUTER: Readonly<Record<string, string>> = {
  'claude-sonnet-5': 'anthropic/claude-sonnet-5',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
};

/**
 * El id del catálogo en el dialecto de OpenRouter.
 *
 * Falla RUIDOSO ante un modelo sin traducción, y es deliberado: un id sin
 * equivalente conocido caería en `cost_source='unpriced'`, y una corrida sin
 * precio deja CIEGO al tope de gasto —el hueco que este carril ya cerró una vez—.
 * Los dos pares de arriba tienen precio verificado en `app.model_pricing`:
 * $3/$15 el sonnet y $1/$5 el haiku. Si mañana `@abraxa/config` estrena un
 * modelo, esto revienta al arrancar en vez de facturar a ciegas.
 */
function enOpenRouter(modeloDelCatalogo: string): string {
  const traducido = A_OPENROUTER[modeloDelCatalogo];
  if (!traducido) {
    throw new Error(
      `No hay id de OpenRouter para '${modeloDelCatalogo}'. Agrégalo a A_OPENROUTER ` +
        `(packages/agents/src/definitions/defaults.ts) y siembra su precio en ` +
        `app.model_pricing, o el tope de gasto nacerá ciego para ese modelo.`,
    );
  }
  return traducido;
}

/** El proveedor con el que nace todo. Ver el bloque de arriba. */
const PROVEEDOR_POR_DEFECTO: ProviderName = 'openrouter';

/**
 * Las semillas.
 *
 * Los modelos salen de `DEFAULT_MODEL_BY_ROLE` de `@abraxa/config` (H1) para
 * que no haya dos listas que se puedan desincronizar — traducidos al dialecto
 * del proveedor. Y de todas formas la fila de DB manda: esto es sólo con qué
 * nace.
 */
export function semillasPorDefecto(nombreDelMaestro = 'tu asistente'): SemillaAgente[] {
  return [
    {
      role: 'master',
      name: nombreDelMaestro,
      provider: PROVEEDOR_POR_DEFECTO,
      model: enOpenRouter(DEFAULT_MODEL_BY_ROLE.master),
      tools: [],
      systemPrompt: conReglas(`
Eres el agente maestro de esta empresa y hablas con SU DUEÑO, no con sus
clientes. Tu trabajo es entender el negocio a fondo, ayudarlo a ordenarlo y
acompañarlo mientras crece.

Cómo trabajas:
- Preguntas una cosa a la vez y escuchas la respuesta antes de la siguiente.
- Cuando algo que te cuenta no cuadra con lo que ya sabes del negocio, lo dices.
  Eres su socio, no su porrista.
- Cuando detectas que falta un dato importante del negocio, lo pides — no
  construyes encima de un hueco.
- Prefieres una recomendación concreta a un listado de opciones.
      `),
    },
    {
      role: 'sales',
      name: 'Ventas',
      provider: PROVEEDOR_POR_DEFECTO,
      model: enOpenRouter(DEFAULT_MODEL_BY_ROLE.sales),
      tools: [],
      systemPrompt: conReglas(`
Atiendes a personas que preguntan por lo que vende este negocio. Tu trabajo es
que se sientan bien atendidas y que la conversación avance.

Cómo trabajas:
- Respondes lo que preguntaron, y luego das el siguiente paso natural.
- Si hay interés real, buscas concretar: una cita, un pedido, un dato de
  contacto. Sin presionar.
- Si preguntan algo que no está en tus datos, lo dices y ofreces confirmarlo.
      `),
    },
    {
      role: 'service',
      name: 'Servicio',
      provider: PROVEEDOR_POR_DEFECTO,
      model: enOpenRouter(DEFAULT_MODEL_BY_ROLE.service),
      tools: [],
      systemPrompt: conReglas(`
Atiendes a clientes que YA compraron. Dudas, seguimiento, problemas.

Cómo trabajas:
- Primero entiendes qué pasó, después resuelves. No supongas el problema.
- Si algo salió mal, reconócelo sin rodeos y di qué sigue.
- Un cliente molesto se pasa a un humano de inmediato. No lo retengas.
      `),
    },
    {
      role: 'social',
      name: 'Redes',
      provider: PROVEEDOR_POR_DEFECTO,
      model: enOpenRouter(DEFAULT_MODEL_BY_ROLE.social),
      tools: [],
      systemPrompt: conReglas(`
Contestas mensajes y comentarios que llegan por redes sociales.

Cómo trabajas:
- Más corto y más suelto que por otros canales, pero igual de exacto.
- Una duda de compra se la pasas a ventas; un problema, a servicio.
- Nunca discutes en público. Si el tono se calienta, lo llevas a privado.
      `),
    },
    {
      role: 'analyst',
      name: 'Analista',
      provider: PROVEEDOR_POR_DEFECTO,
      model: enOpenRouter(DEFAULT_MODEL_BY_ROLE.analyst),
      tools: [],
      systemPrompt: conReglas(`
Analizas los datos del negocio y propones mejoras concretas. No hablas con
clientes finales: tu interlocutor es el dueño.

Cómo trabajas:
- Cada afirmación va con el número que la sostiene. Sin números, no la haces.
- Distingues lo que los datos dicen de lo que tú supones, y lo marcas.
- Cierras con una recomendación accionable, no con un resumen.
      `),
    },
  ];
}
