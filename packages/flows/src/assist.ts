/**
 * ════════════════════════════════════════════════════════════════════════════
 *  "Descríbelo en español" → una automatización ejecutable.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      «Cuando entre un lead por mi página, mándale un mensaje, métemelo en la
 *       etapa de Contactado, y que el agente de ventas lo contacte.»
 *
 *  ── Lo que de verdad hace segura a esta función ────────────────────────────
 *
 *  NO es el modelo. Es que su salida pasa entera por `validate.ts` antes de
 *  existir, contra el catálogo REAL de esta empresa. Un modelo que inventa un
 *  uuid de etapa produce un 422 con el error en español, no un flujo que falla
 *  en su tercer paso tres días después.
 *
 *  Por eso hay DOS intentos: al primero se le regresan sus propios errores y
 *  se le pide que los corrija. Es más barato que un humano depurando por qué
 *  su automatización no corrió.
 *
 *  ── Sobre el proveedor: contra el port, no contra una llave ────────────────
 *
 *  Se llama a `AgentPort.run()` (H3) y no a un HTTP de OpenRouter. Consecuencia
 *  buena: el presupuesto por tenant, el ledger de consumo y la elección de
 *  modelo son de H3 y no se reimplementan aquí — el asistente cuesta dinero y
 *  ese dinero se mide donde se mide todo lo demás.
 *
 *  ⚠ VERIFICADO EL 2026-07-31, y contradice la §9 del handoff: NO existe hoy
 *  un proveedor que funcione sin llaves. `packages/agents/src/providers/
 *  local.ts` no devuelve un JSON fijo — RECHAZA con `PROVIDER_ERROR` diciendo
 *  "todavía no tiene adaptador (está planeado para v2)". Así que sin
 *  `ANTHROPIC_API_KEY` ni `OPENROUTER_API_KEY` este camino responde 503
 *  diciéndolo, y no se inventa una propuesta de mentira: un asistente que
 *  contesta con un flujo fijo mientras aparenta haber entendido lo que le
 *  pediste es peor que uno que dice que no está disponible.
 *
 *  Lo que SÍ está probado hoy, entero y sin red, es el validador — que es lo
 *  que la propia §9 identifica como la pieza que este criterio de verdad
 *  ejercita. Ver `validate.test.ts`.
 */
import { PlatformError, usePort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { CATALOGO, DISPARADORES } from './catalog';
import { catalogoDelTenant } from './service';
import { validar } from './validate';
import type { CatalogoDelTenant, Propuesta } from './validate';

const MAX_DESCRIPCION = 2000;
const INTENTOS = 2;

/**
 * El prompt se arma DESDE el catálogo, no a mano.
 *
 * Si alguien agrega un nodo a `catalog.ts` y no lo implementa en el motor, la
 * prueba de cobertura falla; y si lo implementa, el asistente se entera solo.
 * Es la misma ley de siempre: la UI —y el modelo— no prometen nada que el
 * worker no corra.
 */
export function promptDelSistema(catalogo: CatalogoDelTenant): string {
  const nodos = CATALOGO.filter((n) => n.tipo !== 'trigger')
    .map((n) => {
      const campos = n.campos
        .map((c) => `${c.clave}${c.requerido ? '*' : ''} (${c.tipo})`)
        .join(', ');
      return `- "${n.tipo}" — ${n.resumen}${campos ? ` · config: ${campos}` : ''}`;
    })
    .join('\n');

  const disparadores = DISPARADORES.map(
    (d) => `- "${d.tipo}" — ${d.resumen}${d.filtros.length ? ` · filtros: ${d.filtros.map((f) => f.clave).join(', ')}` : ''}`,
  ).join('\n');

  const etapas = catalogo.etapas.length
    ? catalogo.etapas.map((e) => `  · ${e.slug} ("${e.name}", embudo ${e.pipelineSlug})`).join('\n')
    : '  (esta empresa todavía no tiene embudo: no uses el paso "move_stage")';

  const equipo = catalogo.miembros.length
    ? catalogo.miembros.map((m) => `  · ${m.email}${m.name ? ` (${m.name})` : ''}`).join('\n')
    : '  (todavía no hay más gente en el equipo)';

  return `Eres el asistente de automatizaciones de ABRAXA, la plataforma con la que un
emprendedor hace que su negocio trabaje solo. Hablas español de México.

Convierte lo que te pida en UN flujo en JSON. Responde SÓLO el JSON, sin markdown
y sin explicación.

FORMATO EXACTO:
{
  "name": "nombre corto y claro",
  "description": "una línea de qué hace",
  "trigger_type": "<uno de los disparadores de abajo>",
  "trigger_config": {},
  "definition": { "nodes": [...], "edges": [...] },
  "notes": "los supuestos que tomaste, o null"
}

DISPARADORES:
${disparadores}

PASOS DISPONIBLES (los ÚNICOS que el motor ejecuta — no inventes otros; * = obligatorio):
${nodos}

Cada nodo es {"id":"n1","type":"<tipo>","data":{"config":{…}}}. Va EXACTAMENTE UN
nodo {"id":"inicio","type":"trigger","data":{}} y el flujo arranca ahí.

CONEXIONES: {"id":"e1","source":"inicio","target":"n1"}. Una sola salida por paso,
salvo "condition", que lleva exactamente dos: una con "sourceHandle":"yes" y otra
con "sourceHandle":"no". La rama que no haga nada se conecta a un paso "end".

VARIABLES para los mensajes: {nombre} {nombre_completo} {fecha} {hora} {vendedor}
{responsable} {etapa}, y los valores de la bóveda de la empresa: {valor.*},
{precio.*}, {empresa.*}, {marca.*}.

ETAPAS REALES DE ESTA EMPRESA (usa el slug, no inventes ninguno):
${etapas}

EQUIPO REAL DE ESTA EMPRESA:
${equipo}

REGLAS:
- El flujo va SIEMPRE hacia adelante: prohibidos los ciclos y las conexiones que regresan.
- No dejes pasos sueltos: a todos se llega desde el disparador.
- Mensajes cálidos, breves, en español de México, con {nombre}.
- Máximo 12 pasos.
- Si el usuario menciona una etapa o una persona que no está en las listas de arriba,
  usa la más parecida y dilo en "notes".
- El flujo se guardará EN PAUSA. No digas nada sobre activarlo.`;
}

/** Saca el JSON de una respuesta que pudo venir con adornos. */
export function extraerJson(texto: string): unknown {
  const limpio = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
  const inicio = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  if (inicio === -1 || fin <= inicio) {
    throw new PlatformError('PROVIDER_ERROR', 'el asistente no devolvió un flujo');
  }
  return JSON.parse(limpio.slice(inicio, fin + 1));
}

/**
 * De una descripción en español a una propuesta VÁLIDA.
 *
 * Devuelve la propuesta, no el flujo guardado: quien decide guardarla es el
 * humano, en el builder, viendo lo que se propuso. La IA no escribe nada sola.
 */
export async function proponer(
  ctx: TenantContext,
  descripcion: string,
): Promise<{ propuesta: Propuesta; intentos: number; notas: string | null }> {
  const texto = descripcion.trim();
  if (!texto) throw new PlatformError('VALIDATION', 'describe qué quieres que pase solo');
  if (texto.length > MAX_DESCRIPCION) {
    throw new PlatformError('VALIDATION', `la descripción es muy larga (máx ${MAX_DESCRIPCION} caracteres)`);
  }

  const catalogo = await catalogoDelTenant(ctx);
  const agentes = usePort('agents');

  let peticion = texto;
  let ultimosErrores: string[] = [];

  for (let intento = 1; intento <= INTENTOS; intento++) {
    const r = await agentes.run(ctx, {
      role: 'analyst',
      input: peticion,
      systemSuffix: promptDelSistema(catalogo),
    });

    let errores: string[];
    try {
      const v = validar(extraerJson(r.text), catalogo);
      if (v.ok && v.propuesta) {
        return { propuesta: v.propuesta, intentos: intento, notas: v.propuesta.notes ?? null };
      }
      errores = v.errores;
    } catch (err) {
      errores = [err instanceof Error ? err.message : 'la respuesta no se pudo leer'];
    }

    ultimosErrores = errores;
    // El re-prompt lleva los MISMOS mensajes en español que vería un humano.
    // Un error que sólo entiende el validador no le sirve ni al modelo ni al
    // emprendedor.
    peticion =
      `${texto}\n\n---\nTu propuesta anterior tenía estos problemas. Corrígelos TODOS y ` +
      `responde SÓLO el JSON completo corregido:\n- ${errores.join('\n- ')}`;
  }

  throw new PlatformError(
    'VALIDATION',
    'el asistente no logró armar un flujo que se pueda ejecutar. Puedes armarlo a mano en el lienzo.',
    { details: { errores: ultimosErrores } },
  );
}
