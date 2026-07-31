/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La ventana del cierre — hallazgo 1 de la auditoría del PR #8.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `concurrencia.test.ts` ya enfrentaba dos `responder()` a la vez, pero en la
 *  fase 'identidad', y ahí el lock optimista los resuelve: las dos leen el mismo
 *  `turns`, una gana y la otra muere con CONFLICT ANTES de escribir nada. Por
 *  eso aquella prueba pasaba con este defecto puesto.
 *
 *  En 'sintesis' la carrera es OTRA, y es peor:
 *
 *    1. El turno que cierra la fase 5 COMMITEA `phase='sintesis'`, `turns=n+1`
 *       y —aquí está el defecto— `status='activa'`.
 *    2. Recién entonces entra `cerrar()`: guarda el blueprint, siembra el giro,
 *       manda el documento madre a la bóveda y CORRE EL MODELO OTRA VEZ para
 *       narrar el mapa. Entre 5 y 30 segundos.
 *    3. `status='completada'` se escribe hasta el final de todo eso.
 *
 *  O sea que durante toda la fase 6 la fila dice, a quien pregunte, que el
 *  Ritual sigue activo. La segunda petición pasa el guardia de `responder()`,
 *  no choca con el lock —porque la primera YA escribió y la segunda lee el
 *  `turns` nuevo, limpio—, y como `siguienteFase('sintesis')` es null se queda
 *  en 'sintesis' y VUELVE A ENTRAR a `cerrar()`.
 *
 *  Y el disparador no es hipotético: es el propio producto. El BFF corta a los
 *  90 s —el único turno que puede tardar tanto es justo éste— y le dice a la
 *  emprendedora «vuelve a mandar tu mensaje». Reenviar es un click.
 *
 *  Lo que queda escrito: dos blueprints, dos documentos madre en la bóveda con
 *  los mismos valores canónicos, y un 409 en la cara de quien sí esperó.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import { crearFakeDb, type Fila } from '../testing/fake-db';
import { crearAgenteFalso, ctxDePrueba, type AgenteFalso } from '../testing/agente-falso';
import { crearBovedaFalsa, type BovedaFalsa } from '../testing/boveda-falsa';
import {
  ENTREGA,
  ENTREVISTA_COMPLETA,
  HASTA_GENTE,
  PLANTILLAS_DE_GIRO,
  ULTIMO_MENSAJE,
} from '../testing/guion-de-prueba';
import { cargarSesion } from './repositorio';
import { iniciar, responder } from './ritual';
import type { RespuestaDelRitual, TurnoTranscrito } from '../types';

/** La entrada con la que `cerrar()` le pide al modelo que narre el mapa. */
const NARRACION = 'EL MAPA QUE YA CALCULÉ';

let db: ReturnType<typeof crearFakeDb>;
let agente: AgenteFalso;
let boveda: BovedaFalsa;
let restaurar: () => void;

function montar(inicial: Record<string, Fila[]> = {}, ...guion: string[]): void {
  db = crearFakeDb(inicial);
  restaurar = __setClientForTests(db.cliente);
  agente = crearAgenteFalso(...guion);
  boveda = crearBovedaFalsa();
  registerPort('agents', agente);
  registerPort('vault', boveda);
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

/** Lleva el Ritual hasta 'gente': a un solo mensaje de la síntesis. */
async function hastaElBordeDeLaSintesis(): Promise<void> {
  const ctx = ctxDePrueba();
  agente.guion(...ENTREVISTA_COMPLETA);
  await iniciar(ctx);
  for (const dicho of HASTA_GENTE) await responder(ctx, dicho);

  const s = await cargarSesion(ctx);
  if (s?.fase !== 'gente') throw new Error(`el andamio esperaba 'gente' y quedó en '${s?.fase}'`);
}

// ═════════════════════════════════════════════════════════════════════════════
describe('cerrar() · la ventana entre la fase 6 y `completada`', () => {
  it('la segunda petición que cae en la ventana NO siembra un segundo mapa', async () => {
    const ctx = ctxDePrueba();
    await hastaElBordeDeLaSintesis();

    // Nos paramos DENTRO de `cerrar()`: justo en la segunda corrida del modelo,
    // la que narra el mapa. Todos los efectos de la fase 6 —blueprint, giro,
    // bóveda— ya ocurrieron; `status='completada'` todavía no.
    const barrera = agente.detener((input) => input.includes(NARRACION));

    const cierre = responder(ctx, ULTIMO_MENSAJE);
    await barrera.alcanzada;

    // Ésta es LA aserción de la causa raíz. La fila ya entró a la fase 6, así
    // que tiene que decirlo: la bandera se escribe en el mismo UPDATE que puso
    // la fase en 'sintesis', no treinta segundos después. Con el defecto puesto
    // aquí dice 'activa', y eso es lo que deja pasar a la segunda petición.
    const enLaVentana = await cargarSesion(ctx);
    expect(enLaVentana?.fase).toBe('sintesis');
    expect(enLaVentana?.status).toBe('cerrando');
    expect(db.filas('onboarding_blueprints')).toHaveLength(1);
    expect(boveda.documentos).toHaveLength(1);

    // Y aquí cae la segunda petición: la que el propio BFF le pidió mandar al
    // cortar a los 90 s. No choca con el lock —la primera ya escribió— y no
    // hay nada más que la detenga.
    agente.guion('Ah, galletas también. Buen dato.', ENTREGA);
    const segunda = await responder(ctx, 'ah, y también vendo galletas').catch(
      (e: unknown) => e,
    );

    barrera.liberar();
    const primera = await cierre.catch((e: unknown) => e);

    // ── Lo que tiene que quedar en la base ────────────────────────────────
    //
    // Un Ritual, un mapa. El blueprint es la decisión que se le prometió al
    // cliente y el documento madre es lo que H4 va a clasificar: duplicar
    // cualquiera de los dos le deja la bóveda con los mismos valores
    // canónicos dos veces, sin un solo error que lo delate.
    expect(db.filas('onboarding_blueprints')).toHaveLength(1);
    expect(db.filas('onboarding_blueprints')[0]?.version).toBe(1);
    expect(boveda.documentos).toHaveLength(1);

    // La que esperó el cierre completo es la que se lleva el mapa. La que
    // llegó tarde se entera, y se entera ANTES de escribir nada.
    expect(primera).not.toBeInstanceOf(Error);
    expect((primera as RespuestaDelRitual).mapa).not.toBeNull();
    expect(segunda).toMatchObject({ code: 'CONFLICT' });

    // Y el Ritual terminó una sola vez: una entrega, no dos.
    const final = await cargarSesion(ctx);
    expect(final?.status).toBe('completada');
    const entregas = (final?.transcript ?? []).filter((t: TurnoTranscrito) =>
      t.content.includes('Empieza por Ventas'),
    );
    expect(entregas).toHaveLength(1);
  });

  it('un cierre que se murió a medias se retoma sin volver a sembrar', async () => {
    const ctx = ctxDePrueba();
    await hastaElBordeDeLaSintesis();

    // El modo permanente: si el último `guardarTurno` de `cerrar()` no alcanza
    // a correr —el proceso se cae, el deploy reinicia, la red se va— la fila se
    // queda en la fase 6 para siempre. Sin arreglo, CADA mensaje posterior
    // vuelve a correr la fase 6 entera: blueprint v3, v4, y un documento madre
    // nuevo cada vez, sin techo.
    const barrera = agente.detener((input) => input.includes(NARRACION));
    const abandonada = responder(ctx, ULTIMO_MENSAJE);
    await barrera.alcanzada;

    // Aquí se muere el proceso. La barrera NO se libera a propósito: esa
    // petición no vuelve nunca, que es justo lo que pasa cuando el contenedor
    // se reinicia a media fase 6. Lo único que sobrevive es la base.
    void abandonada.catch(() => undefined);
    const foto = JSON.parse(JSON.stringify(Object.fromEntries(db.tablas))) as Record<
      string,
      Fila[]
    >;

    restaurar?.();
    __clearPorts();
    montar(foto);
    agente.guion(ENTREGA);

    const rescatada = await cargarSesion(ctx);
    expect(rescatada?.fase).toBe('sintesis');
    expect(rescatada?.status).not.toBe('completada');

    // La emprendedora vuelve un rato después y escribe. El arrendamiento del
    // cierre ya venció, así que el Ritual tiene que TERMINAR — no quedarse
    // atorado, y tampoco volver a correr la fase 6 desde cero.
    const alRato = new Date(Date.now() + 10 * 60 * 1000);
    const r = await responder(ctx, '¿y mi mapa?', { ahora: alRato });

    expect(r.mapa).not.toBeNull();
    expect(db.filas('onboarding_blueprints')).toHaveLength(1);
    // La bóveda no se vuelve a sembrar: el documento madre de antes de la caída
    // sigue siendo el bueno. (El de la corrida abandonada, que sí alcanzó a
    // escribirse antes del corte, es el único que debe existir.)
    expect(boveda.documentos).toHaveLength(0);
    expect((await cargarSesion(ctx))?.status).toBe('completada');
  });
});
