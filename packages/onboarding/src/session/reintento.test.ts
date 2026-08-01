/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El reenvío después del 504 — hallazgo 2 de la auditoría del PR #8.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El BFF corta a los 90 s con un `AbortController`. Eso cierra el socket
 *  BFF→API, y nada más: el handler de Express no se entera y sigue corriendo.
 *  Termina el modelo, escribe su turno y COMMITEA.
 *
 *  Mientras tanto la pantalla ya le dijo a la emprendedora «vuelve a mandar tu
 *  mensaje: no se perdió nada», el compositor le devolvió el texto y reenviar
 *  es un click. Cuando reenvía, la API lee el `turns` NUEVO —el que dejó la
 *  petición abandonada— y el reenvío pasa limpio.
 *
 *  ── Por qué el lock optimista no cubre esto ───────────────────────────────
 *
 *  `turns` protege escrituras CONCURRENTES: dos peticiones que leyeron la misma
 *  versión. Aquí no hay concurrencia — hay un reintento SECUENCIAL, y el
 *  reintento lee la versión que la primera ya dejó escrita. El lock hace
 *  exactamente lo que promete y aun así el turno se aplica dos veces.
 *
 *  Lo que hace falta es distinguir el ENVÍO, no la versión de la fila.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import { crearFakeDb, type Fila } from '../testing/fake-db';
import { crearAgenteFalso, ctxDePrueba, type AgenteFalso } from '../testing/agente-falso';
import { crearBovedaFalsa } from '../testing/boveda-falsa';
import { DOLOR, ENTREGA, GENTE, PLANTILLAS_DE_GIRO } from '../testing/guion-de-prueba';
import { cargarSesion } from './repositorio';
import { responder } from './ritual';
import type { TurnoTranscrito } from '../types';

/** Lo que escribió la emprendedora, y el id con el que su navegador lo mandó. */
const TEXTO = 'lo que más me pesa es cobrarles a tiempo';
const ENVIO = 'b4f0a2d6-0f3e-4a51-9c77-2a1d6f0e5c33';

const T0 = '2026-07-31T18:00:00.000Z';
const AHORA = new Date('2026-07-31T18:01:40.000Z');

/**
 * Una respuesta que NO cierra la fase: el caso simple del reintento.
 *
 * La sesión de abajo va en 'gente', que desde el reordenamiento del 2026-08-01
 * es la penúltima de preguntas. Falta su `equipo_detalle`, así que este turno
 * anota algo y la fase sigue abierta — que es justo lo que la prueba necesita.
 */
const SIGUE_EN_GENTE = `Uf, cobrar a tiempo. ¿Y quién te ayuda con eso hoy?

[DOLOR:le pagan tarde y persigue los cobros|direccion]`;

let db: ReturnType<typeof crearFakeDb>;
let agente: AgenteFalso;
let restaurar: () => void;

/** El Ritual a media entrevista: fase 'gente', 12 turnos, todo lo previo dicho. */
function sesionEnGente(): Fila {
  const dijo = (role: 'user' | 'assistant', content: string): TurnoTranscrito => ({
    role,
    content,
    at: T0,
    fase: 'gente',
  });

  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    tenant_id: 'tenant-a',
    phase: 'gente',
    state: {
      agente: 'Aura',
      categoria: 'Es una panadería',
      equipo: 'Somos de 2 a 5',
      giro: 'panadería artesanal',
      nicho: 'cafeterías independientes',
      etapa: 'operando',
      tamano: '12 clientes fijos',
      modeloIngreso: 'pedido semanal recurrente',
      ticket: '4,500 al mes por cafetería',
      margen: '35%',
      canales: ['whatsapp', 'recomendación'],
      recorrido: [
        { nombre: 'le escriben por WhatsApp', como: 'contesta él en el celular' },
        { nombre: 'cotiza el pedido', como: 'calculadora y memoria' },
        { nombre: 'entrega los lunes', como: 'camioneta propia' },
      ],
      herramientas: ['whatsapp', 'libreta'],
    },
    transcript: [dijo('assistant', '¿Y quién te ayuda hoy con la entrega?')],
    status: 'activa',
    turns: 12,
    checkpoint_at: T0,
    created_at: T0,
    updated_at: T0,
  };
}

function montar(...guion: string[]): void {
  db = crearFakeDb({
    onboarding_sessions: [sesionEnGente()],
    tenants: [{ id: 'tenant-a', slug: 'tenant-a', name: 'Panadería' }],
    industry_templates: PLANTILLAS_DE_GIRO,
  });
  restaurar = __setClientForTests(db.cliente);
  agente = crearAgenteFalso(...guion);
  registerPort('agents', agente);
  registerPort('vault', crearBovedaFalsa());
}

afterEach(() => {
  restaurar?.();
  __clearPorts();
});

const suyos = (t: TurnoTranscrito[]): TurnoTranscrito[] =>
  t.filter((x) => x.role === 'user' && x.content === TEXTO);

// ═════════════════════════════════════════════════════════════════════════════
describe('el reenvío que el propio BFF pidió', () => {
  beforeEach(() => montar(SIGUE_EN_GENTE, 'no debería correr una segunda vez'));

  it('no vuelve a aplicar el turno: mismo envío, mismo id', async () => {
    const ctx = ctxDePrueba();

    // t=95 s · la petición que el BFF dio por muerta termina y SÍ escribe.
    const primera = await responder(ctx, TEXTO, { ahora: AHORA, turnoId: ENVIO });
    expect((await cargarSesion(ctx))?.turnos).toBe(13);

    // t=100 s · la emprendedora reenvía, tal como se le indicó en pantalla.
    // Es el mismo envío: su navegador conserva el id hasta que aterrice.
    const reenvio = await responder(ctx, TEXTO, { ahora: AHORA, turnoId: ENVIO });

    const s = await cargarSesion(ctx);

    // Su frase entró una vez. Dos veces significa que el agente le contesta a
    // algo que ella dijo una sola vez, y con dos respuestas distintas.
    expect(suyos(s?.transcript ?? [])).toHaveLength(1);
    expect(s?.turnos).toBe(13);

    // Y no se gastó una segunda corrida del modelo en reprocesar lo mismo.
    expect(agente.corridas).toHaveLength(1);

    // El reenvío devuelve la foto vigente: lo que ya había, no un turno nuevo.
    expect(reenvio.mensaje).toBe(primera.mensaje);
    expect(reenvio.vista.turnos).toBe(13);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('el reenvío cuando el turno abandonado SÍ cerró la fase', () => {
  beforeEach(() => montar(GENTE, DOLOR, ENTREGA));

  it('no camina el Ritual dos fases con datos que nadie dio', async () => {
    const ctx = ctxDePrueba();

    // El turno abandonado cerró 'gente'. La fila quedó en 'dolor'.
    await responder(ctx, TEXTO, { ahora: AHORA, turnoId: ENVIO });
    expect((await cargarSesion(ctx))?.fase).toBe('dolor');

    // El reenvío del MISMO mensaje se procesa como si fuera la respuesta a la
    // pregunta de la última fase — que nadie le ha hecho todavía. El modelo,
    // que ve el guion de 'dolor', contesta lo de 'dolor', sella la fase y
    // dispara la síntesis con datos que la emprendedora nunca dio.
    await responder(ctx, TEXTO, { ahora: AHORA, turnoId: ENVIO });

    const s = await cargarSesion(ctx);
    expect(s?.fase).toBe('dolor');
    expect(s?.status).toBe('activa');
    expect(suyos(s?.transcript ?? [])).toHaveLength(1);

    // Y ningún turno suyo quedó sellado en una fase en la que no habló.
    expect(suyos(s?.transcript ?? []).every((t) => t.fase === 'gente')).toBe(true);

    // Sobre todo: no hay mapa. Llegar a la síntesis por un reenvío es entregarle
    // su Mapa de Negocio a alguien a quien le faltaba media entrevista.
    expect(db.filas('onboarding_blueprints')).toHaveLength(0);
  });
});
