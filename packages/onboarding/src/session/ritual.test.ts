/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El criterio #2, que es el que define el handoff.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  «Completa 3 fases, cierra el navegador, vuelve al día siguiente y el agente
 *  retoma con el contexto intacto, sin repetir preguntas.»
 *
 *  La prueba de abajo no simula eso con una bandera: SERIALIZA la base a JSON,
 *  tira todo lo que estaba vivo en memoria —el cliente, el port del agente, la
 *  instancia entera— y reconstruye el mundo desde cero, que es exactamente lo
 *  que le pasa a un proceso que se reinició en la madrugada. Si el Ritual
 *  guardara una sola cosa importante en una variable de módulo, aquí se cae.
 *
 *  Es la prueba que GARDEN no tenía, y por eso su motor de entrevista lleva el
 *  historial en un `Map` del proceso sin que nadie lo haya notado.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import { crearFakeDb, type Fila } from '../testing/fake-db';
import { crearAgenteFalso, ctxDePrueba, type AgenteFalso } from '../testing/agente-falso';
import { fotoDelRitual, historialParaElModelo, iniciar, pausar, responder } from './ritual';
import type { TurnoTranscrito } from '../types';

// ════════════════════════════════════════════════════════════════════════════
// El guion de una entrevista real
// ════════════════════════════════════════════════════════════════════════════

const SALUDO = 'Hola. Voy a ser tu agente, pero todavía no tengo nombre. ¿Cómo me quieres llamar?';

const BAUTIZO = `Aura. Me gusta.

Ahora sí: cuéntame a qué te dedicas.
[DATO:agente=Aura][FASE_COMPLETA:bienvenida]`;

const IDENTIDAD = `Entonces panadería artesanal para cafeterías de la ciudad, ya operando, unos 12 clientes fijos. Anotado.

[DATO:giro=panadería artesanal][DATO:nicho=cafeterías independientes][DATO:etapa=operando][DATO:tamano=12 clientes fijos]
[FASE_COMPLETA:identidad]`;

const MODELO = `Perfecto: pedido semanal recurrente, ticket de 4,500 al mes por cafetería, margen como del 35%.

[DATO:modelo_ingreso=pedido semanal recurrente][DATO:ticket=4,500 al mes por cafetería][DATO:margen=35%]
[LISTA:canales=whatsapp, recomendación]
[FASE_COMPLETA:modelo]`;

const PROCESO = `Ya me quedó claro el recorrido.

[PASO:le escriben por WhatsApp|contesta él en el celular]
[PASO:cotiza el pedido|calculadora y memoria]
[PASO:entrega los lunes|camioneta propia]
[LISTA:herramientas=whatsapp, libreta]
[FASE_COMPLETA:proceso]`;

const DOLOR = `Entonces los domingos en la noche se te juntan los pedidos y a veces uno se pierde entre los mensajes.

[DOLOR:se le pierden pedidos entre los mensajes del domingo|ventas]
[DOLOR:cotiza de memoria y a veces se equivoca de precio|direccion]
[HITO:ventas|Que los pedidos del domingo entren solos a una lista|Hoy dependen de que él alcance a leer todo]
[FASE_COMPLETA:dolor]`;

const GENTE = `Solo tú, con tu hermano ayudando los lunes.

[DATO:equipo=solo, con ayuda los lunes][DATO:equipo_detalle=su hermano apoya en la entrega]
[FASE_COMPLETA:gente]`;

const ENTREGA = 'Aquí está tu Mapa de Negocio. Empieza por Ventas.';

// ════════════════════════════════════════════════════════════════════════════
// Andamio
// ════════════════════════════════════════════════════════════════════════════

let db: ReturnType<typeof crearFakeDb>;
let agente: AgenteFalso;
let restaurar: () => void;

function montar(inicial: Record<string, Fila[]> = {}, ...guion: string[]): void {
  db = crearFakeDb(inicial);
  restaurar = __setClientForTests(db.cliente);
  agente = crearAgenteFalso(...guion);
  registerPort('agents', agente);
}

function desmontar(): void {
  restaurar?.();
  __clearPorts();
}

/**
 * Un reinicio de verdad: la base se serializa a JSON y todo lo demás se tira.
 *
 * El JSON no es cosmética — es lo que garantiza que nada que sólo existiera
 * como referencia en memoria sobreviva al corte.
 */
function reiniciarElMundo(...guion: string[]): void {
  const foto = JSON.parse(JSON.stringify(Object.fromEntries(db.tablas))) as Record<string, Fila[]>;
  desmontar();
  montar(foto, ...guion);
}

beforeEach(() => {
  montar();
});

afterEach(() => {
  desmontar();
});

// ════════════════════════════════════════════════════════════════════════════

describe('reanudación real — criterio #2', () => {
  it('retoma al día siguiente con el contexto intacto y sin volver a preguntar', async () => {
    const ctx = ctxDePrueba();
    const lunes = new Date('2026-07-27T20:00:00.000Z');

    // ── Día 1: tres fases ───────────────────────────────────────────────────
    agente.guion(SALUDO, BAUTIZO, IDENTIDAD, MODELO);

    await iniciar(ctx, lunes);
    await responder(ctx, 'Aura', lunes);
    await responder(ctx, 'hago pan artesanal para cafeterías', lunes);
    const tercera = await responder(ctx, 'les cobro por pedido semanal', lunes);

    expect(tercera.vista.fase).toBe('proceso');
    expect(tercera.vista.progreso).toBe(43); // 3 de 7 fases cerradas
    expect(tercera.vista.agente).toBe('Aura');

    const turnosDelDia1 = db.filas('onboarding_sessions')[0]?.transcript as TurnoTranscrito[];
    expect(turnosDelDia1.length).toBeGreaterThan(0);

    // ── Cierra el navegador. El proceso se muere. ───────────────────────────
    const martes = new Date('2026-07-28T21:00:00.000Z');
    reiniciarElMundo();

    // ── Día 2: lo primero que ve, sin gastar un token ──────────────────────
    const foto = await fotoDelRitual(ctx, martes);

    expect(agente.corridas).toHaveLength(0); // no se llamó al modelo para pintar
    expect(foto.vista.fase).toBe('proceso');
    expect(foto.vista.agente).toBe('Aura');
    expect(foto.ausencia).toBe('ayer');
    expect(foto.transcript).toEqual(turnosDelDia1);

    // La memoria es concreta: sus datos, no un "¿en qué estábamos?".
    expect(foto.memoria).toContain('panadería artesanal');
    expect(foto.memoria).toContain('4,500');
    expect(foto.memoria).toContain('Aura');

    // ── Sigue escribiendo, y el agente NO repite ───────────────────────────
    agente.guion(PROCESO);
    const cuarta = await responder(ctx, 'les escriben por WhatsApp y yo contesto', martes);

    const corrida = agente.ultima();

    // Todo lo del día anterior viaja en el prompt: por construcción no puede
    // volver a preguntar el giro, el nicho, el ticket ni el margen.
    expect(corrida.systemSuffix).toContain('LO QUE YA SABES');
    expect(corrida.systemSuffix).toContain('panadería artesanal');
    expect(corrida.systemSuffix).toContain('cafeterías independientes');
    expect(corrida.systemSuffix).toContain('4,500 al mes por cafetería');
    expect(corrida.systemSuffix).toContain('35%');
    expect(corrida.systemSuffix).toContain('No vuelvas a preguntar nada que esté arriba');

    // Y sabe que volvió, para que el saludo sea el de quien te recordaba.
    expect(corrida.systemSuffix).toContain('ÉL ACABA DE VOLVER');
    expect(corrida.systemSuffix).toContain('ayer');

    // El historial literal cruzó el reinicio completo. Va uno menos que el
    // transcript porque el saludo inicial del agente se recorta: la Messages
    // API no acepta una conversación que abre el asistente.
    expect(corrida.history).toHaveLength(turnosDelDia1.length - 1);
    expect(corrida.history.map((h) => h.content)).toContain('Aura');
    expect(corrida.history[0]?.role).toBe('user');

    expect(cuarta.vista.fase).toBe('dolor');
  });

  it('el historial que se le manda al modelo nunca empieza con el asistente', () => {
    const t = (role: 'user' | 'assistant', content: string): TurnoTranscrito => ({
      role,
      content,
      at: '2026-07-27T20:00:00.000Z',
      fase: 'identidad',
    });

    // La Messages API de Anthropic rechaza una conversación que abre el
    // asistente, y el transcript del Ritual SIEMPRE abre así: el agente saluda
    // antes de que el emprendedor escriba nada.
    const h = historialParaElModelo([t('assistant', 'hola'), t('user', 'qué tal'), t('assistant', 'ok')]);
    expect(h[0]?.role).toBe('user');
    expect(h).toHaveLength(2);

    // Y después de recortar por ventana, también.
    const largo = [t('assistant', 'a'), t('user', 'b'), t('assistant', 'c'), t('user', 'd')];
    expect(historialParaElModelo(largo, 3)[0]?.role).toBe('user');
  });

  it('fusiona turnos seguidos del mismo rol: la API exige que alternen', () => {
    const t = (role: 'user' | 'assistant', content: string): TurnoTranscrito => ({
      role,
      content,
      at: '2026-07-27T20:00:00.000Z',
      fase: 'identidad',
    });

    // Es alcanzable de verdad: entrar a /ritual produce un turno del agente sin
    // turno del emprendedor, así que quien vuelve, lee el saludo y se va sin
    // contestar deja dos del asistente seguidos.
    const h = historialParaElModelo([
      t('assistant', 'saludo'),
      t('user', 'hola'),
      t('assistant', 'primera'),
      t('assistant', 'de regreso'),
    ]);

    expect(h.map((x) => x.role)).toEqual(['user', 'assistant']);
    expect(h[1]?.content).toBe('primera\n\nde regreso');
  });

  it('pausar no pierde nada y volver a escribir retoma sin ceremonia', async () => {
    const ctx = ctxDePrueba();
    agente.guion(SALUDO, BAUTIZO);

    await iniciar(ctx);
    await responder(ctx, 'Aura');

    const vista = await pausar(ctx);
    expect(vista.status).toBe('pausada');

    reiniciarElMundo(IDENTIDAD);

    const r = await responder(ctx, 'hago pan');
    expect(r.vista.status).toBe('activa');
    expect(r.vista.fase).toBe('modelo');
    // No hizo falta un "continuar": escribir ES retomar.
    expect(agente.ultima().systemSuffix).toContain('ÉL ACABA DE VOLVER');
  });
});

describe('el Ritual completo', () => {
  it('llega al Mapa de Negocio con áreas, hitos y valores', async () => {
    const ctx = ctxDePrueba();
    // Con la empresa ya dada de alta, para poder verificar que el giro
    // detectado aterriza en `app.tenants` como pide el §7 del handoff.
    desmontar();
    montar({
      tenants: [{ id: 'tenant-a', slug: 'tenant-a', name: 'Panadería' }],
      // El catálogo de giros de H4 (migración 033), para que la resolución de
      // `industry_type` corra de verdad y no por falta de filas.
      industry_templates: [
        { id: 'servicios', name: 'Servicios profesionales', blurb: 'Despachos, consultorios, talleres, salones, estudios.', position: 1 },
        { id: 'comercio', name: 'Comercio y tienda en linea', blurb: 'Vendes producto: local, tienda en linea, marketplace.', position: 2 },
        { id: 'restaurante', name: 'Restaurante y cafeteria', blurb: 'Cocinas y vendes en el momento: local, para llevar o reparto.', position: 3 },
        { id: 'agencia', name: 'Agencia o estudio', blurb: 'Vendes trabajo por proyecto o por iguala: marketing, diseno, software.', position: 4 },
        { id: 'general', name: 'Otro giro', blurb: 'Lo minimo que todo negocio necesita tener claro.', position: 9 },
      ],
    });
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
    expect(foto.vista.progreso).toBe(100);
    expect(foto.mapa).not.toBeNull();

    // Criterio #1: termina con áreas e hitos creados.
    expect(foto.mapa?.areas.length).toBe(6);
    expect(foto.mapa?.hitos.length).toBeGreaterThan(0);
    // "panadería artesanal" no corresponde a ninguna de las cinco plantillas
    // sembradas, así que el giro queda SIN clasificar — y eso se ve. Antes se
    // escribía `panaderia-artesanal`, que parecía un id bueno y no lo era:
    // `detectGaps()` de la bóveda lo buscaba en el catálogo y no encontraba
    // nada. Ver synthesis/industria.ts y su prueba.
    expect(foto.mapa?.industryType).toBeNull();
    // Lo que el emprendedor dijo no se pierde por eso: va en el documento madre.
    expect(foto.mapa?.resumen).toContain('panadería artesanal');

    // Criterio #7: puede entrar a usar al menos un área.
    expect(foto.mapa?.areas.some((a) => a.estado !== 'bloqueada')).toBe(true);

    // Criterio #8: al menos un hito que él no pidió.
    expect(foto.mapa?.hitos.some((h) => h.origen === 'abogado_del_diablo')).toBe(true);

    // El blueprint quedó persistido, y pendiente de proyectar porque H11 no
    // ha registrado su sink. Ése es el estado CORRECTO, no un fallo.
    const blueprints = db.filas('onboarding_blueprints');
    expect(blueprints).toHaveLength(1);
    expect(blueprints[0]?.applied_at).toBeUndefined();

    // Criterio #3: el nombre llegó a la definición del agente.
    expect(agente.definiciones.some((d) => d.role === 'master' && d.name === 'Aura')).toBe(true);

    // La etapa se escribió en app.tenants (handoff §7). `industry_type` NO: la
    // columna apunta a app.industry_templates.id y este giro no cuadró con
    // ninguna plantilla. Vacía es correcto; un slug inventado no lo era.
    const empresa = db.filas('tenants')[0];
    expect(empresa?.industry_type).toBeUndefined();
    expect(empresa?.stage).toBe('operando');
  });

  it('un turno se guarda entero: fase, estado y transcript en la misma escritura', async () => {
    const ctx = ctxDePrueba();
    agente.guion(SALUDO, BAUTIZO);

    await iniciar(ctx);
    await responder(ctx, 'Aura');

    const fila = db.filas('onboarding_sessions')[0];
    expect(fila?.phase).toBe('identidad');
    expect((fila?.state as { agente?: string }).agente).toBe('Aura');
    expect((fila?.transcript as TurnoTranscrito[]).length).toBe(3);
    expect(fila?.turns).toBe(2);
    // El checkpoint se sella al CERRAR una fase, no en cada turno.
    expect(fila?.checkpoint_at).toBeTruthy();
  });
});

describe('aislamiento entre clientes', () => {
  it('el ritual de una empresa no es visible desde otra', async () => {
    agente.guion(SALUDO, BAUTIZO);

    const a = ctxDePrueba('tenant-a');
    await iniciar(a);
    await responder(a, 'Aura');

    const b = ctxDePrueba('tenant-b');
    const foto = await fotoDelRitual(b);

    expect(foto.nuevo).toBe(true);
    expect(foto.transcript).toEqual([]);
    expect(foto.vista.agente).toBeNull();
  });
});
