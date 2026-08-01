/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El paso que no tenía pantalla: hablar con tu agente DESPUÉS del Ritual.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Auditoría del 2026-07-31. Terminado el Ritual, el emprendedor se quedaba sin
 *  forma de volver a hablar con su agente en TODO el producto: `responder()`
 *  devolvía `{ mensaje: '' }` sin correr el modelo y la pantalla escondía el
 *  compositor. Veía su Mapa, veía sus valores… y perdía justo la parte que
 *  impresiona — preguntarle a SU agente por SU negocio y que conteste sabiendo
 *  de qué habla.
 *
 *  No hacía falta ni un endpoint nuevo ni un canal: es el mismo motor con otra
 *  tarea. Estas pruebas fijan las cuatro propiedades que lo hacen un producto y
 *  no un `if`:
 *
 *    1. contesta de verdad (corre el modelo)
 *    2. contesta SABIENDO de este negocio (las cifras van en el prompt)
 *    3. la plática se guarda (recargar no la borra)
 *    4. platicar no reabre el Ritual (ni la barra retrocede, ni la fase 6
 *       se vuelve a disparar)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import { crearFakeDb, type Fila } from '../testing/fake-db';
import { crearAgenteFalso, ctxDePrueba, type AgenteFalso } from '../testing/agente-falso';
import {
  BAUTIZO,
  DOLOR,
  ENTREGA,
  GENTE,
  IDENTIDAD,
  MODELO,
  PLANTILLAS_DE_GIRO,
  PROCESO,
  SALUDO,
} from '../testing/guion-de-prueba';
import { fotoDelRitual, iniciar, responder } from './ritual';
import type { TurnoTranscrito } from '../types';

let db: ReturnType<typeof crearFakeDb>;
let agente: AgenteFalso;
let restaurar: () => void;

function montar(inicial: Record<string, Fila[]> = {}): void {
  db = crearFakeDb(inicial);
  restaurar = __setClientForTests(db.cliente);
  agente = crearAgenteFalso();
  registerPort('agents', agente);
}

beforeEach(() => {
  montar({
    tenants: [{ id: 'tenant-a', slug: 'tenant-a', name: 'Panadería' }],
    industry_templates: PLANTILLAS_DE_GIRO,
  });
});

afterEach(() => {
  restaurar?.();
  __clearPorts();
});

/** Deja el Ritual COMPLETADO, como lo dejaría un invitado del evento. */
async function ritualTerminado(): Promise<ReturnType<typeof ctxDePrueba>> {
  const ctx = ctxDePrueba();
  agente.guion(SALUDO, BAUTIZO, IDENTIDAD, MODELO, PROCESO, DOLOR, GENTE, ENTREGA);

  await iniciar(ctx);
  for (const dicho of [
    'Aura',
    'pan artesanal',
    'cobro por pedido semanal',
    'me escriben por WhatsApp',
    'los domingos se me juntan',
    'estoy solo',
  ]) {
    await responder(ctx, dicho);
  }

  const foto = await fotoDelRitual(ctx);
  expect(foto.vista.status).toBe('completada');
  return ctx;
}

describe('después del Ritual, el agente sigue contestando', () => {
  it('contesta de verdad: corre el modelo y devuelve texto', async () => {
    const ctx = await ritualTerminado();
    const corridasAntes = agente.corridas.length;

    agente.guion('Cobras 4,500 al mes por cafetería. Con 12 clientes son 54,000.');
    const r = await responder(ctx, '¿cuánto cobro?');

    expect(agente.corridas.length).toBe(corridasAntes + 1);
    expect(r.mensaje).toContain('4,500');
    // El Mapa se devuelve con cada turno: la pantalla lo sigue pintando.
    expect(r.mapa).not.toBeNull();
  });

  it('contesta SABIENDO de este negocio: sus cifras van en el prompt', async () => {
    const ctx = await ritualTerminado();

    agente.guion('Va.');
    await responder(ctx, '¿cómo voy?');

    const suffix = agente.ultima().systemSuffix;
    expect(suffix).toContain('YA TERMINÓ EL RITUAL DE FUNDACIÓN');
    // Lo que le contó en la entrevista sigue enfrente del modelo.
    expect(suffix).toContain('panadería artesanal');
    expect(suffix).toContain('4,500 al mes por cafetería');
    expect(suffix).toContain('35%');
    // Y su agente se llama como él lo bautizó.
    expect(suffix).toContain('Aura');
    // Ya no se le pide cerrar fases: la entrevista terminó.
    expect(suffix).not.toContain('LO QUE FALTA PARA CERRAR ESTA FASE');
  });

  it('el agente maestro quedó con los números del negocio en su definición', async () => {
    await ritualTerminado();

    const maestro = [...agente.definiciones].reverse().find((d) => d.role === 'master');
    expect(maestro?.name).toBe('Aura');
    // Sin esto, preguntarle «¿cuánto cobro?» dependería de que alguien hubiera
    // aprobado a mano los borradores de la bóveda.
    expect(maestro?.systemPrompt).toContain('4,500 al mes por cafetería');
    expect(maestro?.systemPrompt).toContain('35%');
    expect(maestro?.systemPrompt).toContain('whatsapp');
  });

  it('la plática se guarda: recargar la página no la borra', async () => {
    const ctx = await ritualTerminado();
    const antes = (await fotoDelRitual(ctx)).transcript.length;

    agente.guion('Empieza por los pedidos del domingo.');
    await responder(ctx, '¿por dónde empiezo?');

    const foto = await fotoDelRitual(ctx);
    // Los dos turnos: el suyo y el del agente.
    expect(foto.transcript.length).toBe(antes + 2);

    const ultimos = foto.transcript.slice(-2) as TurnoTranscrito[];
    expect(ultimos[0]?.role).toBe('user');
    expect(ultimos[0]?.content).toBe('¿por dónde empiezo?');
    expect(ultimos[1]?.role).toBe('assistant');
    expect(ultimos[1]?.content).toContain('pedidos del domingo');
  });

  it('platicar NO reabre el Ritual ni vuelve a disparar la fase 6', async () => {
    const ctx = await ritualTerminado();
    const blueprintsAntes = db.filas('onboarding_blueprints').length;

    agente.guion('Claro.');
    const r = await responder(ctx, 'una pregunta más');

    expect(r.vista.status).toBe('completada');
    expect(r.vista.progreso).toBe(100);
    expect(r.avanzo).toBe(false);
    // La fase 6 es cara y tiene efectos: si se volviera a disparar, el negocio
    // terminaría con dos Mapas y su documento madre duplicado.
    expect(db.filas('onboarding_blueprints').length).toBe(blueprintsAntes);
  });

  it('un reenvío del mismo mensaje no le cobra otra corrida', async () => {
    const ctx = await ritualTerminado();

    agente.guion('Te contesto una vez.');
    const envio = '11111111-1111-4111-8111-111111111111';
    const primera = await responder(ctx, '¿y mi margen?', { turnoId: envio });

    const corridas = agente.corridas.length;
    const segunda = await responder(ctx, '¿y mi margen?', { turnoId: envio });

    expect(agente.corridas.length).toBe(corridas);
    expect(segunda.mensaje).toBe(primera.mensaje);

    // Y no se duplicó en su conversación.
    const foto = await fotoDelRitual(ctx);
    const suyos = foto.transcript.filter((t) => t.content === '¿y mi margen?');
    expect(suyos).toHaveLength(1);
  });

  it('lo que aprenda platicando también se guarda', async () => {
    const ctx = await ritualTerminado();

    agente.guion('Ah, entonces subiste el precio. Anotado. [DATO:ticket=5,200 al mes]');
    await responder(ctx, 'ya subí el precio a 5,200');

    const fila = db.filas('onboarding_sessions')[0];
    expect((fila?.state as { ticket?: string }).ticket).toBe('5,200 al mes');
    // Y la fase no se movió por eso.
    expect(fila?.phase).toBe('sintesis');
    expect(fila?.status).toBe('completada');
  });
});
