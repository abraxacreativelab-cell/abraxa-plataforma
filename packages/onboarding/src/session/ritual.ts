/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El Ritual — el orquestador.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Un turno, de arriba abajo:
 *
 *      1. sesión      ← de la BASE. Nunca de una variable de módulo.
 *      2. guion       ← fase + todo lo que ya se sabe del negocio
 *      3. modelo      ← AgentPort.run() con historial EXPLÍCITO
 *      4. máquina     ← marcadores → estado nuevo, ¿cerró la fase?
 *      5. escritura   ← fase + estado + transcript, en UN update
 *      6. cierre      ← si tocó síntesis: mapa, blueprint, entrega
 *
 *  ── Por qué el paso 1 y el 5 son los importantes ──────────────────────────
 *
 *  El criterio #2 del handoff —completar 3 fases, cerrar el navegador, volver
 *  al día siguiente y que el agente retome con el contexto intacto— no se gana
 *  con una función de "reanudar". Se gana porque en este archivo NO existe
 *  estado vivo entre peticiones: cada turno lee la fila, la usa y la reescribe
 *  entera. Reanudar mañana y contestar dos segundos después son literalmente el
 *  mismo código; la única diferencia es un bloque de más en el prompt para que
 *  el agente salude como quien te recordaba.
 *
 *  Esa propiedad se prueba en session/ritual.test.ts tirando el servicio a la
 *  basura a media entrevista y construyendo uno nuevo.
 */
import { PlatformError, usePort } from '@abraxa/db';
import type { AgentRunResult, TenantContext } from '@abraxa/db';
import { guionDelTurno, PROMPT_MAESTRO_BASE } from '../interview/guion';
import { FASES, FICHAS, indiceDeFase, progresoDe } from '../interview/fases';
import { faltantesDe } from '../interview/cierre';
import { aplicarTurno } from '../interview/maquina';
import { ausenciaEnPalabras, mensajeDeRegreso } from '../interview/regreso';
import { log } from '../logger';
import { aplicarBlueprint, blueprintVigente, guardarBlueprint } from '../synthesis/blueprint';
import { bautizarAgente, sembrarBoveda, sembrarGiro } from '../synthesis/entrega';
import { construirMapa, mensajeDeEntrega } from '../synthesis/mapa';
import type {
  EstadoNegocio,
  MapaDeNegocio,
  RespuestaDelRitual,
  SesionRitual,
  TurnoTranscrito,
  VistaDelRitual,
} from '../types';
import { abrirSesion, cargarSesion, guardarTurno, marcarEstado } from './repositorio';

/**
 * Cuántos turnos del transcript se le mandan al modelo.
 *
 * El límite no le quita memoria: lo que el agente SABE viaja en el bloque «LO
 * QUE YA SABES» del guion, que es estructurado y no crece con la charla. Esto
 * es sólo el tono reciente de la conversación.
 */
const VENTANA_HISTORIAL = 40;

/**
 * Entradas sintéticas para los turnos que no arranca el emprendedor.
 *
 * Van como `input` de la corrida pero NO entran al transcript: son
 * instrucciones al modelo, no cosas que alguien dijo. Meterlas al transcript
 * haría que mañana el agente leyera que su dueño escribió "(el emprendedor
 * acaba de entrar)", que es exactamente el tipo de basura que envenena un
 * historial largo.
 */
const ENTRADA_ARRANQUE = '(acaba de entrar por primera vez; salúdalo y arranca)';
const ENTRADA_REGRESO = '(acaba de volver a una entrevista que dejó a medias; retómala)';
const ENTRADA_CIERRE = '(ya tienes todo; entrégale su Mapa de Negocio)';

// ════════════════════════════════════════════════════════════════════════════
// Historial
// ════════════════════════════════════════════════════════════════════════════

/**
 * El transcript, listo para `AgentRunInput.history`.
 *
 * DOS TRAMPAS DE LA MESSAGES API, Y LAS DOS SON ALCANZABLES AQUÍ:
 *
 *  1. **No puede abrir el asistente.** El transcript del Ritual SIEMPRE abre
 *     así: el agente saluda antes de que el emprendedor escriba nada. Se
 *     recorta el arranque — y después de aplicar la ventana, no antes, porque
 *     la ventana puede dejar otro assistant al frente.
 *
 *  2. **Los roles tienen que alternar.** Y aquí se pueden repetir de verdad:
 *     entrar a /ritual produce un turno del agente sin turno del emprendedor,
 *     así que quien vuelve, lee el saludo y se va otra vez sin contestar deja
 *     dos mensajes del asistente seguidos. La siguiente vez que escriba, la API
 *     devolvería 400. Se fusionan.
 *
 * Fusionar y no tirar: el saludo de regreso menciona datos concretos de su
 * negocio, y perderlo haría que el agente se contradijera con algo que la
 * persona sí tiene en pantalla.
 */
export function historialParaElModelo(
  transcript: TurnoTranscrito[],
  ventana = VENTANA_HISTORIAL,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const recientes = transcript.slice(-ventana);

  let desde = 0;
  while (desde < recientes.length && recientes[desde]?.role === 'assistant') desde++;

  const salida: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const t of recientes.slice(desde)) {
    const previo = salida[salida.length - 1];
    if (previo && previo.role === t.role) previo.content = `${previo.content}\n\n${t.content}`;
    else salida.push({ role: t.role, content: t.content });
  }
  return salida;
}

// ════════════════════════════════════════════════════════════════════════════
// La vista
// ════════════════════════════════════════════════════════════════════════════

export function vistaDe(s: SesionRitual): VistaDelRitual {
  const completada = s.status === 'completada';
  return {
    fase: s.fase,
    faseIndice: indiceDeFase(s.fase),
    fasesTotales: FASES.length,
    progreso: progresoDe(s.fase, completada),
    tituloDeFase: FICHAS[s.fase].titulo,
    status: s.status,
    agente: s.estado.agente?.trim() || null,
    turnos: s.turnos,
    checkpointAt: s.checkpointAt,
    faltante: completada ? [] : faltantesDe(s.fase, s.estado),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// El agente
// ════════════════════════════════════════════════════════════════════════════

/**
 * Corre el agente maestro con el guion del Ritual.
 *
 * Si el tenant todavía no tiene definición de agente maestro —H2 siembra los
 * cinco al aprovisionar, pero el Ritual puede llegar antes— se crea una de
 * arranque y se reintenta UNA vez. Que el primer emprendedor del día se topara
 * con un 404 por un orden de siembra sería absurdo.
 */
async function correrAgente(
  ctx: TenantContext,
  entrada: string,
  systemSuffix: string,
  historial: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AgentRunResult> {
  const agents = usePort('agents');
  const peticion = { role: 'master' as const, input: entrada, systemSuffix, history: historial };

  try {
    return await agents.run(ctx, peticion);
  } catch (err) {
    if (!(PlatformError.is(err) && err.code === 'NOT_FOUND')) throw err;

    log.info('el tenant no tenía agente maestro; se crea uno de arranque y se reintenta');
    await agents.upsertDefinition(ctx, {
      role: 'master',
      name: 'tu asistente',
      systemPrompt: PROMPT_MAESTRO_BASE,
    });
    return agents.run(ctx, peticion);
  }
}

function turno(role: 'user' | 'assistant', content: string, fase: SesionRitual['fase'], ahora: Date): TurnoTranscrito {
  return { role, content, at: ahora.toISOString(), fase };
}

// ════════════════════════════════════════════════════════════════════════════
// Leer el estado
// ════════════════════════════════════════════════════════════════════════════

export interface FotoDelRitual {
  vista: VistaDelRitual;
  transcript: TurnoTranscrito[];
  /** El resumen determinista de "esto es lo que ya sé de ti". Sin modelo. */
  memoria: string;
  /** Hace cuánto se fue, en palabras. `null` si no se fue. */
  ausencia: string | null;
  mapa: MapaDeNegocio | null;
  /** `true` si nunca ha empezado el Ritual. */
  nuevo: boolean;
}

/**
 * Todo lo que la pantalla necesita para pintarse, sin gastar un token.
 *
 * Que esto no llame al modelo es lo que hace que quien vuelve tres días después
 * abra la página y vea inmediatamente su conversación y lo que el agente sabe
 * de él. El saludo del agente llega después, cuando conteste.
 */
export async function fotoDelRitual(ctx: TenantContext, ahora = new Date()): Promise<FotoDelRitual> {
  const sesion = await cargarSesion(ctx);

  if (!sesion) {
    return {
      vista: {
        fase: 'bienvenida',
        faseIndice: 0,
        fasesTotales: FASES.length,
        progreso: 0,
        tituloDeFase: FICHAS.bienvenida.titulo,
        status: 'activa',
        agente: null,
        turnos: 0,
        checkpointAt: null,
        faltante: faltantesDe('bienvenida', {}),
      },
      transcript: [],
      memoria: '',
      ausencia: null,
      mapa: null,
      nuevo: true,
    };
  }

  const ausencia = ausenciaEnPalabras(sesion.updatedAt, ahora);
  const mapa =
    sesion.status === 'completada' ? ((await blueprintVigente(ctx)) ?? null) : null;

  return {
    vista: vistaDe(sesion),
    transcript: sesion.transcript,
    memoria:
      sesion.turnos > 0 ? mensajeDeRegreso(sesion.estado, sesion.fase, ausencia) : '',
    ausencia,
    mapa: mapa
      ? {
          industryType: mapa.industryType,
          areas: mapa.areas,
          hitos: mapa.hitos,
          resumen: mapa.resumen,
        }
      : null,
    nuevo: false,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Arrancar
// ════════════════════════════════════════════════════════════════════════════

/**
 * Abre el Ritual y produce el primer mensaje del agente.
 *
 * Idempotente: si ya había ritual, no lo reinicia. Devuelve el turno que
 * corresponda —el saludo de regreso si venía a medias— porque "empezar" y
 * "volver" son la misma acción desde la UI: entrar a /ritual.
 */
export async function iniciar(ctx: TenantContext, ahora = new Date()): Promise<RespuestaDelRitual> {
  const previa = await cargarSesion(ctx);
  const sesion = previa ?? (await abrirSesion(ctx));

  if (sesion.status === 'completada') {
    return { mensaje: '', vista: vistaDe(sesion), avanzo: false, mapa: await mapaDe(ctx) };
  }

  const regresa = sesion.turnos > 0;
  const ausencia = regresa ? ausenciaEnPalabras(sesion.updatedAt, ahora) : null;

  return correrTurno(ctx, sesion, {
    entrada: regresa ? ENTRADA_REGRESO : ENTRADA_ARRANQUE,
    delUsuario: null,
    regresa,
    ausencia,
    ahora,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Responder
// ════════════════════════════════════════════════════════════════════════════

/** Un turno del emprendedor. */
export async function responder(
  ctx: TenantContext,
  texto: string,
  ahora = new Date(),
): Promise<RespuestaDelRitual> {
  const limpio = texto.trim();
  if (!limpio) throw new PlatformError('VALIDATION', 'El mensaje viene vacío.');

  const sesion = (await cargarSesion(ctx)) ?? (await abrirSesion(ctx));

  if (sesion.status === 'completada') {
    return { mensaje: '', vista: vistaDe(sesion), avanzo: false, mapa: await mapaDe(ctx) };
  }

  // Volver a escribir ES retomar. Nadie debería tener que apretar "continuar"
  // para seguir una conversación que dejó a medias.
  const regresa = sesion.status === 'pausada' || sesion.turnos === 0;
  const ausencia = ausenciaEnPalabras(sesion.updatedAt, ahora);

  return correrTurno(ctx, sesion, {
    entrada: limpio,
    delUsuario: limpio,
    regresa: regresa || ausencia !== null,
    ausencia,
    ahora,
  });
}

interface OpcionesDeTurno {
  entrada: string;
  /** Lo que escribió el emprendedor, o `null` si el turno lo disparó el sistema. */
  delUsuario: string | null;
  regresa: boolean;
  ausencia: string | null;
  ahora: Date;
}

async function correrTurno(
  ctx: TenantContext,
  sesion: SesionRitual,
  o: OpcionesDeTurno,
): Promise<RespuestaDelRitual> {
  const guion = guionDelTurno(sesion.fase, sesion.estado, {
    regresa: o.regresa,
    ausencia: o.ausencia,
    // Del turno ANTERIOR. Sin esto, un agente al que se le negó el cierre
    // vuelve a preguntar lo mismo con otras palabras esperando otro resultado:
    // no tiene forma de saber por qué no avanzó.
    cierreDenegado: sesion.estado.senales?.cierreDenegado === true,
  });

  const historial = historialParaElModelo(sesion.transcript);
  const corrida = await correrAgente(ctx, o.entrada, guion, historial);
  const r = aplicarTurno(sesion.fase, sesion.estado, corrida.text);

  // ── La escritura. Una sola, con todo. ─────────────────────────────────────
  const transcript = [...sesion.transcript];
  if (o.delUsuario) transcript.push(turno('user', o.delUsuario, sesion.fase, o.ahora));
  if (r.visible) transcript.push(turno('assistant', r.visible, r.fase, o.ahora));
  else {
    // Un turno que fue PURO marcador: el modelo extrajo datos y no le dijo nada
    // a la persona. Los datos ya se guardaron arriba, así que no se pierde
    // nada, pero la pantalla se queda muda y eso se ve roto. Se deja dicho en
    // vez de inventarle una frase al agente: poner palabras en su boca es peor
    // que un turno callado.
    log.warn(`turno sin texto visible en la fase '${sesion.fase}': el modelo sólo emitió marcadores`);
  }

  const estado: EstadoNegocio = {
    ...r.estado,
    senales: { cierreDenegado: r.cierreDenegado },
  };

  const actualizada: SesionRitual = {
    ...sesion,
    fase: r.fase,
    estado,
    transcript,
    turnos: sesion.turnos + 1,
    status: r.pausa ? 'pausada' : 'activa',
    checkpointAt: r.avanzo ? o.ahora.toISOString() : sesion.checkpointAt,
    updatedAt: o.ahora.toISOString(),
  };

  await guardarTurno(
    ctx,
    sesion.id,
    {
      fase: actualizada.fase,
      estado: actualizada.estado,
      transcript: actualizada.transcript,
      turnos: actualizada.turnos,
      status: actualizada.status,
      cerroFase: r.avanzo,
    },
    o.ahora,
  );

  // El bautizo se persiste en cuanto ocurre, no al final: es el checkpoint de
  // la fase 0 y lo que hace que el nombre viaje a toda la UI (criterio #3).
  if (r.estado.agente && r.estado.agente !== sesion.estado.agente) {
    await bautizarAgente(ctx, r.estado, null);
  }

  if (r.cierreDenegado) {
    log.info(
      `fase '${sesion.fase}' pidió cerrar y no se le concedió; falta: ` +
        faltantesDe(sesion.fase, r.estado).join(' / '),
    );
  }

  // ── ¿Tocó la síntesis? ────────────────────────────────────────────────────
  if (actualizada.fase === 'sintesis') {
    return cerrar(ctx, actualizada, r.visible, o.ahora);
  }

  return {
    mensaje: r.visible,
    vista: vistaDe(actualizada),
    avanzo: r.avanzo,
    mapa: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// El cierre
// ════════════════════════════════════════════════════════════════════════════

/**
 * La fase 6: construir el mapa, persistirlo y entregarlo.
 *
 * El mapa se construye con código antes de hablarle al modelo. El modelo lo
 * narra; no lo decide. Si el proveedor se cae justo aquí —el único turno que
 * el emprendedor va a recordar— el mapa se entrega igual, con el texto
 * determinista de `mensajeDeEntrega`.
 *
 * Y el orden de las escrituras no es casual: PRIMERO el blueprint. Es la única
 * salida obligatoria, y todo lo demás (giro, bóveda, proyección a H11) puede
 * fallar sin que se pierda el trabajo del cliente.
 */
async function cerrar(
  ctx: TenantContext,
  sesion: SesionRitual,
  mensajePrevio: string,
  ahora: Date,
): Promise<RespuestaDelRitual> {
  const mapa = construirMapa(sesion.estado);

  const guardado = await guardarBlueprint(ctx, sesion.id, mapa);

  // Lo que sigue es best-effort, en orden de importancia para el emprendedor.
  await sembrarGiro(ctx, mapa, sesion.estado);
  await bautizarAgente(ctx, sesion.estado, mapa);
  await sembrarBoveda(ctx, mapa, sesion.estado);
  await aplicarBlueprint(ctx, guardado);

  // El turno de entrega: el agente narra el mapa con su voz.
  let entrega = '';
  try {
    const guion = guionDelTurno('sintesis', sesion.estado, {});
    const corrida = await correrAgente(
      ctx,
      `${ENTRADA_CIERRE}\n\n--- EL MAPA QUE YA CALCULÉ, NÁRRALO ---\n${mapa.resumen}`,
      guion,
      historialParaElModelo(sesion.transcript),
    );
    entrega = aplicarTurno('sintesis', sesion.estado, corrida.text).visible;
  } catch (err) {
    log.warn(`el modelo no pudo narrar el cierre; se entrega el mapa determinista: ${String(err)}`);
  }

  if (!entrega) entrega = mensajeDeEntrega(mapa, sesion.estado);

  const transcript = [...sesion.transcript, turno('assistant', entrega, 'sintesis', ahora)];

  await guardarTurno(
    ctx,
    sesion.id,
    {
      fase: 'sintesis',
      estado: sesion.estado,
      transcript,
      turnos: sesion.turnos + 1,
      status: 'completada',
      cerroFase: true,
      completada: true,
    },
    ahora,
  );

  const final: SesionRitual = {
    ...sesion,
    fase: 'sintesis',
    transcript,
    turnos: sesion.turnos + 1,
    status: 'completada',
    completedAt: ahora.toISOString(),
    checkpointAt: ahora.toISOString(),
  };

  log.info(`ritual completado: ${mapa.areas.length} áreas, ${mapa.hitos.length} hitos`);

  return {
    // El mensaje del turno anterior y la entrega, en una sola burbuja: cerrar
    // la fase 5 y recibir el mapa son un mismo momento.
    mensaje: [mensajePrevio, entrega].filter((m) => m.length > 0).join('\n\n'),
    vista: vistaDe(final),
    avanzo: true,
    mapa,
  };
}

async function mapaDe(ctx: TenantContext): Promise<MapaDeNegocio | null> {
  const b = await blueprintVigente(ctx);
  if (!b) return null;
  return { industryType: b.industryType, areas: b.areas, hitos: b.hitos, resumen: b.resumen };
}

// ════════════════════════════════════════════════════════════════════════════
// Pausar y retomar
// ════════════════════════════════════════════════════════════════════════════

/**
 * "Guardar y seguir después".
 *
 * No guarda nada: ya está todo guardado desde el turno anterior. Sólo deja
 * escrito que se fue por su voluntad, para que al volver el agente sepa que no
 * lo perdió — lo dejó ir. La promesa del §8 se cumple porque la escritura
 * ocurre en cada turno, no porque exista este botón.
 */
export async function pausar(ctx: TenantContext): Promise<VistaDelRitual> {
  const sesion = await cargarSesion(ctx);
  if (!sesion) throw new PlatformError('NOT_FOUND', 'Este negocio todavía no empieza su Ritual.');
  if (sesion.status === 'completada') return vistaDe(sesion);

  await marcarEstado(ctx, sesion.id, 'pausada');
  return vistaDe({ ...sesion, status: 'pausada' });
}

/** Lo que el emprendedor ya le contó a su agente, en su propio idioma. */
export function memoriaDe(estado: EstadoNegocio): string {
  return mensajeDeRegreso(estado, 'bienvenida', null);
}
