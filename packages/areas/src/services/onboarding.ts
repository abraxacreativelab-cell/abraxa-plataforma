/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El mini-onboarding por área (handoff §6)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Cuando desbloquea un área no aterriza en una tabla vacía: el agente maestro
 *  le da un tutorial EMPRESARIAL — corto, sobre su negocio, no sobre la
 *  herramienta. Cuatro pasos:
 *
 *    1. Qué es esta área en TU empresa.
 *    2. Qué cambia cuando la tienes. Concreto.
 *    3. Tres preguntas para configurarla — no veinte.
 *    4. Un primer resultado visible antes de terminar.
 *
 *  ── Es el motor de H7 con otro guion, y por eso el guion está en la base ───
 *
 *  El handoff dice *"es el mismo motor de entrevista de H7 con otro guion"*, y
 *  eso NO significa importar `@abraxa/onboarding`: significa la misma forma de
 *  conversar. El motor de los dos es `AgentPort.run()` con un guion inyectado
 *  por `systemSuffix` — que es justo para lo que H3 lo declaró (*"lo usa H7
 *  para la entrevista"*).
 *
 *  Los guiones viven en `app.area_catalog.script`, uno por área × giro. Escribir
 *  un guion nuevo para restaurantes es un INSERT, no un deploy, y no toca este
 *  archivo. Por eso no hay ni un texto de tutorial aquí abajo.
 *
 *  ── El primer resultado visible ────────────────────────────────────────────
 *
 *  El paso 4 es el que hace que el tutorial no se sienta un formulario: antes
 *  de terminar, con lo que acaba de contestar, se genera algo suyo. Se GUARDA
 *  en `area_onboarding_runs.result`, no sólo se pinta: volver al mapa dos días
 *  después y seguir viendo lo que construyó es el pago del esfuerzo.
 */
import { PlatformError, tenantDb, tryPort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { readIndustry, readScript } from '../data/rpc';
import type { AreaScript, AreaState, OnboardingRun, ScriptAnswer } from '../domain/types';
import { accessFor, marcarActiva, marcarEnProgreso, unaFila } from './areas';

const COLUMNAS = 'tenant_id, area_slug, step, answers, result, completed_at';

/** Tope de una respuesta. Lo que escribe en un campo de texto va a un prompt. */
const MAX_RESPUESTA = 2000;

interface RunRow {
  area_slug: string;
  step: number;
  answers: unknown;
  result: unknown;
  completed_at: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// Lectura
// ════════════════════════════════════════════════════════════════════════════

function comoRespuestas(raw: unknown): ScriptAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ key: String(x.key ?? ''), answer: String(x.answer ?? '') }))
    .filter((x) => x.key);
}

function comoResultado(raw: unknown): OnboardingRun['result'] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const body = typeof o.body === 'string' ? o.body : '';
  if (!body) return null;
  return { kind: String(o.kind ?? 'nota'), label: String(o.label ?? ''), body };
}

function aRun(row: RunRow): OnboardingRun {
  return {
    areaSlug: row.area_slug,
    step: Number(row.step ?? 0),
    answers: comoRespuestas(row.answers),
    result: comoResultado(row.result),
    completedAt: row.completed_at,
  };
}

async function leerRun(ctx: TenantContext, areaSlug: string): Promise<OnboardingRun | null> {
  const { data, error } = await tenantDb(ctx)
    .from('area_onboarding_runs')
    .select(COLUMNAS)
    .eq('area_slug', areaSlug)
    .maybeSingle();

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo leer el onboarding de ${areaSlug}: ${error.message}`);
  }
  return data ? aRun(data as unknown as RunRow) : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Lo que ve la pantalla del tutorial
// ════════════════════════════════════════════════════════════════════════════

export interface OnboardingView {
  areaSlug: string;
  areaLabel: string;
  state: AreaState;
  script: AreaScript;
  run: OnboardingRun | null;
  /** La pregunta que toca ahora. `null` si ya no quedan. */
  question: { key: string; prompt: string; index: number; total: number } | null;
  /** `true` cuando ya contestó todas y falta generar el resultado. */
  readyToFinish: boolean;
}

function preguntaActual(script: AreaScript, run: OnboardingRun | null): OnboardingView['question'] {
  const total = script.questions.length;
  const i = run?.step ?? 0;
  const q = script.questions[i];
  return q ? { key: q.key, prompt: q.prompt, index: i, total } : null;
}

/**
 * El tutorial de un área, en el punto en que se quedó.
 *
 * Exige acceso al área — pero NO exige que esté desbloqueada: ver el guion de un
 * área bloqueada es exactamente lo que el handoff quiere (la promesa se muestra
 * aunque tenga candado). Lo que no se puede es CONTESTAR, y eso lo impide
 * `start()`.
 */
export async function getOnboarding(ctx: TenantContext, areaSlug: string): Promise<OnboardingView> {
  if (accessFor(ctx, areaSlug) === null) {
    throw new PlatformError('FORBIDDEN', `Sin acceso al área "${areaSlug}".`);
  }

  const fila = await unaFila(ctx, areaSlug);
  const script = await readScript(areaSlug, await readIndustry(ctx));
  const run = await leerRun(ctx, areaSlug);

  return {
    areaSlug,
    areaLabel: fila.label || areaSlug,
    state: fila.state,
    script,
    run,
    question: preguntaActual(script, run),
    readyToFinish: Boolean(run) && !preguntaActual(script, run) && !run?.completedAt,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// El recorrido
// ════════════════════════════════════════════════════════════════════════════

/**
 * Empieza el tutorial. Es lo que dispara el desbloqueo (criterio 4).
 *
 * Idempotente: volver a entrar retoma donde se quedó y no borra lo contestado.
 * Un tutorial que se reinicia al recargar la página es un tutorial que nadie
 * termina.
 */
export async function start(ctx: TenantContext, areaSlug: string): Promise<OnboardingView> {
  if (accessFor(ctx, areaSlug) === null) {
    throw new PlatformError('FORBIDDEN', `Sin acceso al área "${areaSlug}".`);
  }

  const fila = await unaFila(ctx, areaSlug);
  if (fila.state === 'bloqueada') {
    throw new PlatformError(
      'FORBIDDEN',
      `El área "${areaSlug}" todavía está bloqueada. Primero hay que abrirla.`,
    );
  }

  if (!(await leerRun(ctx, areaSlug))) {
    const { error } = await tenantDb(ctx)
      .from('area_onboarding_runs')
      .insert({ area_slug: areaSlug, step: 0, answers: [] });
    if (error) {
      throw new PlatformError('INTERNAL', `No se pudo iniciar el onboarding: ${error.message}`);
    }
  }

  await marcarEnProgreso(ctx, areaSlug);
  return getOnboarding(ctx, areaSlug);
}

/**
 * Guarda una respuesta y avanza.
 *
 * Se guarda por CLAVE y no por posición: si vuelve atrás a corregir la segunda,
 * se pisa la segunda y no se agrega una cuarta. El paso queda siempre en la
 * primera pregunta sin contestar, que es donde el usuario espera estar.
 */
export async function answer(
  ctx: TenantContext,
  areaSlug: string,
  key: unknown,
  respuesta: unknown,
): Promise<OnboardingView> {
  const clave = String(key ?? '').trim();
  const texto = String(respuesta ?? '').trim();

  if (!clave) throw new PlatformError('VALIDATION', 'Falta la clave de la pregunta.');
  if (!texto) throw new PlatformError('VALIDATION', 'La respuesta viene vacía.');
  if (texto.length > MAX_RESPUESTA) {
    throw new PlatformError('VALIDATION', `La respuesta no puede pasar de ${MAX_RESPUESTA} caracteres.`);
  }

  const vista = await start(ctx, areaSlug);
  if (!vista.script.questions.some((q) => q.key === clave)) {
    throw new PlatformError('VALIDATION', `El guion de "${areaSlug}" no tiene la pregunta "${clave}".`);
  }

  const previas = vista.run?.answers ?? [];
  const answers = [...previas.filter((a) => a.key !== clave), { key: clave, answer: texto }];

  // El paso es la primera pregunta SIN contestar, no `step + 1`: así corregir
  // una anterior no manda al usuario al final de la lista.
  const contestadas = new Set(answers.map((a) => a.key));
  const idx = vista.script.questions.findIndex((q) => !contestadas.has(q.key));
  const step = idx === -1 ? vista.script.questions.length : idx;

  const { error } = await tenantDb(ctx)
    .from('area_onboarding_runs')
    .update({ answers, step })
    .eq('area_slug', areaSlug);

  if (error) throw new PlatformError('INTERNAL', `No se pudo guardar la respuesta: ${error.message}`);
  return getOnboarding(ctx, areaSlug);
}

// ════════════════════════════════════════════════════════════════════════════
// El primer resultado visible
// ════════════════════════════════════════════════════════════════════════════

function promptDeCierre(script: AreaScript, answers: ScriptAnswer[], areaLabel: string): string {
  const dichas = script.questions
    .map((q) => {
      const a = answers.find((x) => x.key === q.key);
      return a ? `- ${q.prompt}\n  ${a.answer}` : null;
    })
    .filter(Boolean)
    .join('\n');

  return [
    `Acabas de configurar el área "${areaLabel}" con el dueño del negocio.`,
    `Esto fue lo que te dijo, con sus palabras:`,
    dichas,
    '',
    `Devuélvele AHORA: ${script.result?.label ?? 'un primer resultado concreto que pueda usar hoy'}.`,
    '',
    'Reglas:',
    '- Usa SUS palabras y sus cifras. Si no te dio un dato, no lo inventes: dilo.',
    '- Que sea corto y utilizable hoy, no un plan de tres meses.',
    '- Nada de introducciones ni de "aquí tienes": empieza directo por el contenido.',
  ].join('\n');
}

/**
 * Cierra el tutorial: genera el primer resultado visible, lo guarda y deja el
 * área ACTIVA.
 *
 * ── Qué pasa si el agente no está o falla ─────────────────────────────────
 *
 * El área queda activa IGUAL. El tutorial no es una aduana: si el emprendedor
 * ya contestó las tres preguntas, ganarse el área no puede depender de que un
 * proveedor de modelos esté de buenas. El resultado se marca como no generado y
 * la pantalla lo dice con esas palabras — que es más honesto que un texto
 * inventado localmente haciéndose pasar por el análisis del agente.
 */
export async function finish(
  ctx: TenantContext,
  areaSlug: string,
): Promise<{ view: OnboardingView; degraded: string | null }> {
  const vista = await getOnboarding(ctx, areaSlug);

  if (!vista.run) {
    throw new PlatformError('VALIDATION', `El tutorial de "${areaSlug}" no ha empezado.`);
  }
  if (vista.question) {
    throw new PlatformError(
      'VALIDATION',
      `Todavía falta contestar: ${vista.question.prompt}`,
    );
  }

  let degraded: string | null = null;
  let resultado: OnboardingRun['result'] = vista.run.result;

  if (!resultado) {
    const agents = tryPort('agents');
    if (!agents) {
      degraded = 'El motor de agentes (H3) todavía no está registrado.';
    } else {
      try {
        const salida = await agents.run(ctx, {
          role: 'master',
          input: promptDeCierre(vista.script, vista.run.answers, vista.areaLabel),
          // El guion entra como sufijo del system prompt: es el mismo mecanismo
          // con el que H7 corre su entrevista, con otro texto.
          systemSuffix: [vista.script.intro, vista.script.promise].filter(Boolean).join('\n'),
        });
        const cuerpo = salida.text.trim();
        if (cuerpo) {
          resultado = {
            kind: vista.script.result?.kind ?? 'nota',
            label: vista.script.result?.label ?? 'Tu primer resultado',
            body: cuerpo,
          };
        } else {
          degraded = `${salida.agentName} no devolvió nada.`;
        }
      } catch (e) {
        // Un fallo del proveedor NO puede costarle el área que ya se ganó.
        degraded = e instanceof PlatformError ? e.message : 'No se pudo generar el primer resultado.';
      }
    }
  }

  const { error } = await tenantDb(ctx)
    .from('area_onboarding_runs')
    .update({ result: resultado, completed_at: new Date().toISOString() })
    .eq('area_slug', areaSlug);

  if (error) throw new PlatformError('INTERNAL', `No se pudo cerrar el onboarding: ${error.message}`);

  await marcarActiva(ctx, areaSlug);
  return { view: await getOnboarding(ctx, areaSlug), degraded };
}
