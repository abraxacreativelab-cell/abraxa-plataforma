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
import { guionDelTurno, guionDespuesDelRitual, PROMPT_MAESTRO_BASE } from '../interview/guion';
import { FASES, FICHAS, indiceDeFase, progresoDe } from '../interview/fases';
import { faltantesDe } from '../interview/cierre';
import { aplicarTurno } from '../interview/maquina';
import { ausenciaEnPalabras, mensajeDeRegreso } from '../interview/regreso';
import { log } from '../logger';
import { aplicarBlueprint, blueprintVigente, guardarBlueprint } from '../synthesis/blueprint';
import { bautizarAgente, sembrarBoveda, sembrarGiro } from '../synthesis/entrega';
import { plantillasDeGiro } from '../synthesis/industria';
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

/**
 * Cuánto vale el arrendamiento de `status='cerrando'`.
 *
 * `cerrando` cierra la puerta de la fase 6, y una puerta que nadie puede volver
 * a abrir convierte cualquier caída —un deploy, un OOM, la red— en un Ritual
 * muerto para siempre: la fila se queda a un paso del Mapa de Negocio y nadie
 * puede darle ese paso. Por eso es un arrendamiento y no una lápida.
 *
 * Cinco minutos: el cierre corre UNA llamada al modelo, y el BFF ya se rinde a
 * los 90 s. Un cierre vivo jamás llega aquí. Y si llegara —un proveedor
 * lentísimo— retomarlo tampoco rompe nada: la fase 6 es idempotente desde la
 * 052, y de los dos cierres sólo uno puede ganar el `guardarTurno` final.
 */
const ARRENDAMIENTO_DEL_CIERRE_MS = 5 * 60 * 1000;

/** Lo que se le dice a quien tocó la puerta mientras se cerraba el Ritual. */
export const CIERRE_EN_CURSO =
  'Tu agente está armando tu Mapa de Negocio en este momento. ' +
  'Nada se perdió: espera unos segundos y aparece solo.';

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

/**
 * ¿Este Ritual está en la fase 6 sin haberla terminado?
 *
 * Es la pregunta que faltaba. Antes la única que se hacía era «¿ya está
 * completada?», y entre "entró a la fase 6" y "la terminó" hay entre 5 y 30
 * segundos con una ingesta a la bóveda y una corrida del modelo adentro. En ese
 * hueco la fila decía 'activa' y cualquiera podía volver a entrar.
 *
 * Se mira la FASE y no sólo el status: una fila que quedó en 'sintesis' con
 * 'activa' —las que escribió la versión con el defecto— también entra por aquí
 * y se cura sola en vez de re-sembrar la bóveda en cada mensaje.
 */
function cierrePendiente(s: SesionRitual): boolean {
  return s.fase === 'sintesis' && s.status !== 'completada';
}

/** `true` si el cierre en curso ya se pasó de su arrendamiento y se puede retomar. */
function arrendamientoVencido(s: SesionRitual, ahora: Date): boolean {
  const desde = Date.parse(s.updatedAt);
  if (Number.isNaN(desde)) return true;
  return ahora.getTime() - desde >= ARRENDAMIENTO_DEL_CIERRE_MS;
}

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

  // Entrar a la página mientras se cierra el Ritual no puede disparar un turno
  // —sería la fase 6 otra vez— y tampoco puede reventar: abrir una pantalla
  // nunca es un error. Se devuelve lo que hay. Si el cierre se murió a medias,
  // esto es además lo que lo levanta con una recarga.
  if (cierrePendiente(sesion)) {
    if (!arrendamientoVencido(sesion, ahora)) return fotoComoRespuesta(ctx, sesion);
    log.warn(`el cierre del ritual ${sesion.id} venció su arrendamiento; se retoma desde iniciar()`);
    return cerrar(ctx, sesion, '', ahora);
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

export interface OpcionesDeRespuesta {
  ahora?: Date;
  /**
   * Identificador del ENVÍO, no del turno guardado.
   *
   * Lo genera el navegador una vez por mensaje y lo conserva mientras ese
   * mensaje no haya aterrizado: un reenvío del MISMO texto trae el MISMO id.
   * Es lo que distingue "lo volvió a mandar porque el BFF le dijo que se había
   * tardado" de "escribió lo mismo otra vez", que son la misma cadena de texto
   * y significan cosas opuestas.
   */
  turnoId?: string;
}

/** Un turno del emprendedor. */
export async function responder(
  ctx: TenantContext,
  texto: string,
  o: OpcionesDeRespuesta = {},
): Promise<RespuestaDelRitual> {
  const ahora = o.ahora ?? new Date();
  const limpio = texto.trim();
  if (!limpio) throw new PlatformError('VALIDATION', 'El mensaje viene vacío.');

  const sesion = (await cargarSesion(ctx)) ?? (await abrirSesion(ctx));

  // ── ¿Es el mismo envío otra vez? ──────────────────────────────────────────
  //
  // Va ANTES que cualquier otro guardia porque es el caso más amable de los
  // tres: el mensaje sí entró, sólo que quien lo mandó no se enteró. Contestar
  // con lo que ya hay es mejor que un CONFLICT que la pantalla tendría que
  // traducir.
  //
  // El lock por `turns` no puede cubrir esto: protege escrituras concurrentes, y
  // un reenvío llega DESPUÉS, lee la versión nueva y pasa limpio.
  //
  // Y va ANTES de la rama del Ritual terminado desde que ese caso corre el
  // modelo: si no, un reenvío después del cierre le cobraría al cliente una
  // corrida y le duplicaría el turno en su propia conversación.
  if (o.turnoId && sesion.ultimoEnvio === o.turnoId) {
    log.info(
      `envío ${o.turnoId} repetido en el ritual ${sesion.id}: ya está aplicado, ` +
        'se devuelve la foto vigente sin correr el modelo.',
    );
    return fotoComoRespuesta(ctx, sesion);
  }

  // ── El Ritual ya terminó: ahora se PLATICA ────────────────────────────────
  //
  // Antes esto devolvía `{ mensaje: '' }` sin correr el modelo, y con eso el
  // producto se quedaba mudo justo después del único momento que impresiona:
  // el dueño acababa de recibir su Mapa y ya no tenía dónde preguntarle nada a
  // su agente. Ver `guionDespuesDelRitual`.
  if (sesion.status === 'completada') {
    return conversar(ctx, sesion, limpio, ahora, o.turnoId);
  }

  // ── La fase 6 no admite visitas ───────────────────────────────────────────
  if (cierrePendiente(sesion)) {
    if (!arrendamientoVencido(sesion, ahora)) {
      throw new PlatformError('CONFLICT', CIERRE_EN_CURSO);
    }
    // Vencido: el cierre se murió a medias. Se retoma en vez de correr un turno
    // normal —que volvería a entrar a la fase 6 por la puerta de atrás— y no se
    // re-siembra nada, porque desde la 052 el blueprint y el documento madre son
    // uno por Ritual.
    log.warn(`el cierre del ritual ${sesion.id} venció su arrendamiento; se retoma`);
    return cerrar(ctx, sesion, '', ahora, o.turnoId);
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
    // Sin id se manda `undefined`, no `null`: un turno que no trae envío no
    // debe BORRAR el acuse del anterior. Si lo borrara, un reenvío tardío del
    // mensaje de antes volvería a ser irreconocible.
    envioId: o.turnoId,
  });
}

/**
 * Lo que hay, sin gastar un token.
 *
 * Es la respuesta a un reenvío: el último mensaje del agente es literalmente lo
 * que la persona ya debería tener en pantalla, así que devolverlo deja las dos
 * vistas iguales sin volver a preguntarle nada al modelo.
 */
async function fotoComoRespuesta(
  ctx: TenantContext,
  sesion: SesionRitual,
): Promise<RespuestaDelRitual> {
  const ultimo = [...sesion.transcript].reverse().find((t) => t.role === 'assistant');
  return {
    mensaje: ultimo?.content ?? '',
    vista: vistaDe(sesion),
    avanzo: false,
    mapa: sesion.status === 'completada' ? await mapaDe(ctx) : null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Después del Ritual: la conversación de todos los días
// ════════════════════════════════════════════════════════════════════════════

/**
 * Un turno con el Ritual ya cerrado.
 *
 * Es el MISMO motor —el mismo agente maestro, con la bóveda y el contexto de
 * empresa que le inyecta H3— con otra tarea: ya no entrevista, contesta. Por
 * eso no hay un endpoint nuevo ni una pantalla nueva; hay una rama.
 *
 * Tres cosas se conservan del turno normal, y las tres importan:
 *
 *   · **se guarda en el transcript** — recargar la página no borra la plática;
 *   · **se sigue aprendiendo** — un `[DATO:…]` que suelte aquí aterriza en el
 *     estado igual que en la entrevista, así que la bóveda no se congela el día
 *     que cerró el Ritual;
 *   · **el lock optimista por `turns`** — dos pestañas platicando no se pisan.
 *
 * Lo que NO se conserva es la máquina de fases: `sintesis` no tiene siguiente,
 * así que `aplicarTurno` no puede mover nada. La fase se queda donde está por
 * construcción, no por un `if`.
 */
async function conversar(
  ctx: TenantContext,
  sesion: SesionRitual,
  texto: string,
  ahora: Date,
  envioId?: string,
): Promise<RespuestaDelRitual> {
  const mapa = await mapaDe(ctx);
  const guion = guionDespuesDelRitual(sesion.estado, mapa?.resumen ?? null);

  const corrida = await correrAgente(
    ctx,
    texto,
    guion,
    historialParaElModelo(sesion.transcript),
  );
  const r = aplicarTurno('sintesis', sesion.estado, corrida.text);

  const transcript = [...sesion.transcript, turno('user', texto, 'sintesis', ahora)];
  if (r.visible) transcript.push(turno('assistant', r.visible, 'sintesis', ahora));
  else log.warn('turno sin texto visible después del Ritual: el modelo sólo emitió marcadores');

  const actualizada: SesionRitual = {
    ...sesion,
    estado: r.estado,
    transcript,
    turnos: sesion.turnos + 1,
    updatedAt: ahora.toISOString(),
    ultimoEnvio: envioId ?? sesion.ultimoEnvio,
  };

  await guardarTurno(
    ctx,
    sesion.id,
    {
      fase: 'sintesis',
      estado: actualizada.estado,
      transcript: actualizada.transcript,
      turnos: actualizada.turnos,
      // Sigue completada. Platicar no reabre el Ritual: si lo reabriera, la
      // barra de progreso volvería a moverse y la fase 6 podría dispararse otra
      // vez.
      status: 'completada',
      cerroFase: false,
      turnoPrevio: sesion.turnos,
      envioId,
    },
    ahora,
  );

  return { mensaje: r.visible, vista: vistaDe(actualizada), avanzo: false, mapa };
}

interface OpcionesDeTurno {
  entrada: string;
  /** Lo que escribió el emprendedor, o `null` si el turno lo disparó el sistema. */
  delUsuario: string | null;
  regresa: boolean;
  ausencia: string | null;
  ahora: Date;
  /** El envío del que salió este turno. Ausente si no lo disparó el navegador. */
  envioId?: string;
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

  // ── La bandera del cierre se escribe AQUÍ, no al final (auditoría PR #8) ──
  //
  // Éste es el arreglo de la causa raíz, y cabe en una línea porque el defecto
  // también cabía en una: la única bandera que impedía volver a entrar a la
  // fase 6 se escribía DESPUÉS de todos sus efectos. O sea que durante los 5 a
  // 30 segundos que tardan el blueprint, la bóveda y la corrida del modelo que
  // narra el mapa, la fila decía 'activa' y cualquiera podía entrar otra vez.
  //
  // Ahora el MISMO UPDATE que lleva la fase a 'sintesis' deja escrito que el
  // cierre empezó. No hay hueco entre las dos cosas porque son la misma
  // escritura — que es exactamente la propiedad que este archivo ya perseguía
  // para fase, estado y transcript, aplicada a la única que faltaba.
  const entraALaSintesis = r.fase === 'sintesis';

  const actualizada: SesionRitual = {
    ...sesion,
    fase: r.fase,
    estado,
    transcript,
    turnos: sesion.turnos + 1,
    // Entrar a la síntesis gana sobre pausar: no se puede dejar a medias un
    // cierre que ya empezó, y el modelo no tiene por qué decidir eso.
    status: entraALaSintesis ? 'cerrando' : r.pausa ? 'pausada' : 'activa',
    checkpointAt: r.avanzo ? o.ahora.toISOString() : sesion.checkpointAt,
    updatedAt: o.ahora.toISOString(),
    ultimoEnvio: o.envioId ?? sesion.ultimoEnvio,
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
      // La versión que traía la fila cuando se leyó, al principio del turno.
      // Entre esa lectura y esta escritura corrió el modelo: si otra pestaña
      // escribió en ese hueco, esto lanza CONFLICT en vez de pisarla.
      turnoPrevio: sesion.turnos,
      envioId: o.envioId,
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
  if (entraALaSintesis) {
    return cerrar(ctx, actualizada, r.visible, o.ahora, o.envioId);
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
 *
 * ── Se puede llamar dos veces. Es el punto (auditoría PR #8) ──────────────
 *
 * Antes no: cada entrada insertaba un blueprint nuevo y mandaba otro documento
 * madre a la bóveda. Como `status='completada'` se escribía hasta el final,
 * entrar dos veces era fácil —el propio BFF lo pedía al cortar a los 90 s— y
 * nada se quejaba.
 *
 * Ahora las cinco salidas son idempotentes y las cinco lo son en la BASE, no
 * por orden de llamadas:
 *
 *   blueprint   UNIQUE (tenant_id, session_id) · devuelve el que ya había
 *   giro        UPDATE por id, con los mismos valores
 *   agente      upsert de la definición, con el mismo nombre
 *   bóveda      acuse en `vault_document_id`: si está lleno, no se manda
 *   proyección  se salta si el blueprint ya trae `appliedAt`
 *
 * Eso es lo que permite que el arrendamiento de `cerrando` pueda vencer sin
 * miedo, y por lo tanto que una caída a media fase 6 no deje el Ritual muerto.
 */
async function cerrar(
  ctx: TenantContext,
  sesion: SesionRitual,
  mensajePrevio: string,
  ahora: Date,
  envioId?: string,
): Promise<RespuestaDelRitual> {
  // El catálogo de giros de H4, para que `industry_type` apunte a una plantilla
  // que existe y no a un slug inventado. Si la tabla no responde viene vacío y
  // el mapa sale con `industryType: null` — nunca con algo que parezca válido.
  const calculado = construirMapa(sesion.estado, await plantillasDeGiro());

  const guardado = await guardarBlueprint(ctx, sesion.id, calculado);

  // El mapa que se entrega es EL GUARDADO, no el recién calculado. En un cierre
  // normal son el mismo; en uno que se retoma, el guardado es el que ya se le
  // prometió al cliente —y quizá el que H11 ya proyectó—, así que recalcularlo
  // y entregar algo distinto sería cambiarle el mapa por debajo.
  const mapa: MapaDeNegocio = {
    industryType: guardado.industryType,
    areas: guardado.areas,
    hitos: guardado.hitos,
    resumen: guardado.resumen,
  };

  // Lo que sigue es best-effort, en orden de importancia para el emprendedor.
  await sembrarGiro(ctx, mapa, sesion.estado);
  await bautizarAgente(ctx, sesion.estado, mapa);
  await sembrarBoveda(ctx, guardado, sesion.estado);
  // Un blueprint ya proyectado no se vuelve a proyectar: el sink de H11 crea
  // áreas e hitos, y correrlo dos veces le duplicaría el roadmap al negocio.
  if (!guardado.appliedAt) await aplicarBlueprint(ctx, guardado);

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
      // `sesion` aquí es la fila que `correrTurno` acaba de escribir, así que
      // su `turnos` ES la versión vigente. El cierre también corre una llamada
      // al modelo antes de escribir: la carrera es la misma.
      turnoPrevio: sesion.turnos,
      envioId,
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
    ultimoEnvio: envioId ?? sesion.ultimoEnvio,
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
