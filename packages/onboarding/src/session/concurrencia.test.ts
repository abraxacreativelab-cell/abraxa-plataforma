/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Dos peticiones a la vez sobre el mismo Ritual.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * No es un caso de laboratorio. Un turno del Ritual es leer → llamar al modelo
 * → escribir, y la parte de en medio tarda segundos. En ese hueco caben:
 *
 *   · dos pestañas abiertas en /ritual (la segunda dispara `iniciar` sola);
 *   · un doble Enter, o el botón apretado dos veces porque "no pasó nada";
 *   · el reintento automático de un navegador con la red mala.
 *
 * Las dos peticiones leen la MISMA fila, las dos calculan sobre el mismo
 * transcript, y las dos escriben la fila ENTERA. El defecto que se prueba abajo
 * es que la segunda pisaba a la primera sin dejar rastro: ni error, ni log, ni
 * fila huérfana. El emprendedor veía en pantalla un mensaje del agente que, al
 * recargar, ya no existía.
 *
 * Dos escrituras, dos arreglos:
 *
 *   · `guardarTurno` — control de concurrencia optimista con `turns` de número
 *     de versión, en el WHERE del mismo UPDATE.
 *   · `abrirSesion`  — el upsert de PostgREST es DO UPDATE por defecto, así que
 *     "abrir" un ritual que ya existía lo dejaba en cero.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import { crearFakeDb, type Fila } from '../testing/fake-db';
import { crearAgenteFalso, ctxDePrueba, type AgenteFalso } from '../testing/agente-falso';
import { abrirSesion, cargarSesion, guardarTurno } from './repositorio';
import { iniciar, responder } from './ritual';
import type { TurnoTranscrito } from '../types';

const SALUDO = 'Hola. ¿Cómo me quieres llamar?';
const RESPUESTA_A = 'Va, anotado lo del pan. [DATO:giro=panadería]';
const RESPUESTA_B = 'Va, anotado lo de las cafeterías. [DATO:nicho=cafeterías]';

let db: ReturnType<typeof crearFakeDb>;
let agente: AgenteFalso;
let restaurar: () => void;
/** Cuántos SELECT salen vacíos antes de volver a la normalidad. Ver fake-db. */
let cegar = 0;

function montar(inicial: Record<string, Fila[]> = {}, ...guion: string[]): void {
  cegar = 0;
  db = crearFakeDb(inicial, () => {
    if (cegar <= 0) return false;
    cegar--;
    return true;
  });
  restaurar = __setClientForTests(db.cliente);
  agente = crearAgenteFalso(...guion);
  registerPort('agents', agente);
}

beforeEach(() => montar());

afterEach(() => {
  restaurar?.();
  __clearPorts();
});

const turno = (contenido: string): TurnoTranscrito => ({
  role: 'user',
  content: contenido,
  at: '2026-07-31T12:00:00.000Z',
  fase: 'identidad',
});

// ═════════════════════════════════════════════════════════════════════════════
describe('guardarTurno · el turno que se perdía en silencio', () => {
  it('la escritura que llega tarde NO pisa: falla con CONFLICT', async () => {
    const s = await abrirSesion(ctxDePrueba());
    const ctx = ctxDePrueba();

    // Las dos peticiones leyeron la fila con `turns = 0`. La primera escribe.
    await guardarTurno(ctx, s.id, {
      fase: 'identidad',
      estado: { giro: 'panadería' },
      transcript: [turno('hago pan')],
      turnos: 1,
      status: 'activa',
      cerroFase: true,
      turnoPrevio: 0,
    });

    // La segunda llega con el mismo `turnoPrevio`: su cálculo ya es viejo.
    await expect(
      guardarTurno(ctx, s.id, {
        fase: 'bienvenida',
        estado: {},
        transcript: [],
        turnos: 1,
        status: 'activa',
        cerroFase: false,
        turnoPrevio: 0,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Y el trabajo de la primera sigue entero.
    const fila = db.filas('onboarding_sessions')[0];
    expect(fila?.phase).toBe('identidad');
    expect((fila?.state as { giro?: string }).giro).toBe('panadería');
    expect((fila?.transcript as TurnoTranscrito[]).length).toBe(1);
  });

  it('la escritura que va en orden sigue pasando', async () => {
    const ctx = ctxDePrueba();
    const s = await abrirSesion(ctx);

    for (let n = 0; n < 3; n++) {
      await guardarTurno(ctx, s.id, {
        fase: 'identidad',
        estado: {},
        transcript: [turno(`turno ${n}`)],
        turnos: n + 1,
        status: 'activa',
        cerroFase: false,
        turnoPrevio: n,
      });
    }

    expect(db.filas('onboarding_sessions')[0]?.turns).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('el Ritual completo · dos turnos a la vez', () => {
  it('uno gana, el otro se entera, y ninguno desaparece', async () => {
    const ctx = ctxDePrueba();
    agente.guion(SALUDO, RESPUESTA_A, RESPUESTA_B);

    await iniciar(ctx);
    const antes = await cargarSesion(ctx);
    expect(antes?.turnos).toBe(1);

    // Doble Enter: las dos salen antes de que ninguna haya escrito.
    const [a, b] = await Promise.allSettled([
      responder(ctx, 'hago pan artesanal'),
      responder(ctx, 'para cafeterías'),
    ]);

    const estados = [a.status, b.status].sort();
    expect(estados).toEqual(['fulfilled', 'rejected']);

    const perdedora = (a.status === 'rejected' ? a : b) as PromiseRejectedResult;
    expect(perdedora.reason).toMatchObject({ code: 'CONFLICT' });
    // El mensaje es para el emprendedor, no para el log: le dice que no perdió
    // nada y qué hacer.
    expect(String((perdedora.reason as Error).message)).toContain('Nada se perdió');

    // La fila avanzó UNA vez, no dos ni cero, y trae el turno de la que ganó.
    const despues = await cargarSesion(ctx);
    expect(despues?.turnos).toBe(2);
    const transcript = despues?.transcript ?? [];
    expect(transcript.filter((t) => t.role === 'user')).toHaveLength(1);
    expect(transcript[transcript.length - 1]?.role).toBe('assistant');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('abrirSesion · la pestaña que llega tarde', () => {
  it('no reinicia el Ritual que la otra pestaña ya empezó', async () => {
    const ctx = ctxDePrueba();

    // Pestaña A abre y avanza: ya hay entrevista de verdad en la fila.
    const s = await abrirSesion(ctx);
    await guardarTurno(ctx, s.id, {
      fase: 'modelo',
      estado: { giro: 'panadería artesanal', agente: 'Aura' },
      transcript: [turno('hago pan'), turno('para cafeterías')],
      turnos: 4,
      status: 'activa',
      cerroFase: true,
      turnoPrevio: 0,
    });

    // Pestaña B leyó "no hay ritual" ANTES de que A insertara, y hasta ahora
    // llega a escribir. Es la carrera que el comentario de abrirSesion siempre
    // dijo manejar — y que el upsert por defecto (DO UPDATE) convertía en un
    // borrado: `phase: 'bienvenida'`, `transcript: []`, `turns: 0`.
    cegar = 1;
    const b = await abrirSesion(ctx);

    expect(b.fase).toBe('modelo');
    expect(b.turnos).toBe(4);
    expect(b.transcript).toHaveLength(2);
    expect(b.estado.agente).toBe('Aura');

    // Y en la base, un solo ritual, intacto.
    const filas = db.filas('onboarding_sessions');
    expect(filas).toHaveLength(1);
    expect(filas[0]?.phase).toBe('modelo');
    expect((filas[0]?.transcript as TurnoTranscrito[]).length).toBe(2);
  });
});
