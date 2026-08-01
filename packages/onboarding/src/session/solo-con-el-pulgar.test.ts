/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La promesa del embudo invertido, probada de punta a punta.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  «Que la parte de preguntas y respuestas sea mucho más rápida para no perder
 *  al cliente, y poder entregarle algo impresionante ya en la plataforma.»
 *
 *  Traducido a algo verificable, dos afirmaciones:
 *
 *   1. **Un invitado que sólo toca botones llega a su Mapa de Negocio.** Si un
 *      botón manda un valor que no cierra la fase que dice cerrar, esto se pone
 *      rojo — y ése es el modo de fallo que nadie notaría a ojo, porque en la
 *      pantalla los botones se ven perfectos y la entrevista simplemente no
 *      avanza.
 *   2. **Salirse después de la fase 1 ya deja algo construido.** Con cuatro
 *      toques la empresa queda con su giro sembrado, su agente sabiendo a qué
 *      se dedica, y un mapa que distingue este negocio de otro.
 *
 *  La prueba conduce el motor DE VERDAD —`responder()`, la base falsa, la
 *  máquina de estados, el cierre— con un agente de mentiras que hace lo único
 *  que hace un modelo: repetir como marcador lo que el invitado acaba de tocar.
 *  Los valores de los botones NO se escriben aquí: se leen de `ayudas.ts`, así
 *  que cambiar una etiqueta y romper su dato se cacha solo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import { crearFakeDb } from '../testing/fake-db';
import { crearBovedaFalsa } from '../testing/boveda-falsa';
import { crearAgenteFalso, ctxDePrueba, type AgenteFalso } from '../testing/agente-falso';
import { PLANTILLAS_DE_GIRO } from '../testing/guion-de-prueba';
import { ayudaDe } from '../interview/ayudas';
import { primerFaltante } from '../interview/cierre';
import { fotoDelRitual, iniciar, responder } from './ritual';
import { cargarSesion } from './repositorio';

let db: ReturnType<typeof crearFakeDb>;
let agente: AgenteFalso;
let restaurar: () => void;

beforeEach(() => {
  db = crearFakeDb({
    tenants: [{ id: 'tenant-a', slug: 'tenant-a', name: 'Sin nombre todavía' }],
    industry_templates: PLANTILLAS_DE_GIRO,
  });
  restaurar = __setClientForTests(db.cliente);
  agente = crearAgenteFalso();
  registerPort('agents', agente);
  registerPort('vault', crearBovedaFalsa());
});

afterEach(() => {
  restaurar?.();
  __clearPorts();
});

/** El primer botón de un dato, tal como lo vería el invitado. */
function primerBoton(clave: string): string {
  const opcion = ayudaDe(clave)?.opciones[0];
  if (!opcion) throw new Error(`"${clave}" no ofrece botones y esta prueba los necesita`);
  return opcion.valor;
}

/**
 * Lo que hace un modelo bien portado: marcar lo que le acaban de decir.
 *
 * Los datos de lista y los estructurados necesitan su marcador propio; el resto
 * es `[DATO:clave=lo que tocó]`. No hay inteligencia aquí a propósito: si el
 * Ritual avanzara sólo por lo que el modelo decida, esta prueba no probaría
 * nada del producto.
 */
function comoLoMarcaria(clave: string, dicho: string): string {
  switch (clave) {
    case 'canales':
    case 'herramientas':
      return `Va. [LISTA:${clave}=${dicho}]`;
    case 'recorrido':
      return 'Va. [PASO:le escriben|WhatsApp][PASO:cotizo|de memoria][PASO:entrego|en moto]';
    case 'dolores':
      return (
        'Va. [DOLOR:se le juntan los mensajes del sábado|ventas]' +
        '[DOLOR:no sabe cuánto le queda al mes|direccion]' +
        '[HITO:ventas|Que los pedidos del sábado entren solos|hoy dependen de que él lea todo]'
      );
    default:
      return `Va. [DATO:${clave}=${dicho}]`;
  }
}

/** Lo que contesta el invitado a un dato: un botón si lo hay, si no una frase. */
const ESCRITAS: Record<string, string> = {
  agente: 'Sol',
  giro: 'taquería de suadero con reparto en la Roma',
  nicho: 'oficinas de la zona que piden para juntas',
  ticket: 'como $180 por persona',
  recorrido: 'me escriben, cotizo y entrego',
  equipo_detalle: 'mi esposa lleva la caja y yo cocino',
  dolores: 'los sábados se me juntan los mensajes',
};

function loQueContesta(clave: string): string {
  const ayuda = ayudaDe(clave);
  if (ayuda && ayuda.opciones.length > 0) return primerBoton(clave);
  const escrita = ESCRITAS[clave];
  if (!escrita) throw new Error(`falta qué contestar para "${clave}"`);
  return escrita;
}

describe('un invitado que sólo toca botones llega a su Mapa de Negocio', () => {
  it('avanza fase por fase sin que ningún botón se quede a medias', async () => {
    const ctx = ctxDePrueba();

    agente.guion('Hola. Todavía no tengo nombre, ¿cómo me quieres llamar?');
    await iniciar(ctx);

    const tocados: string[] = [];

    // Se contesta SIEMPRE el primer faltante que declara el motor, que es el
    // mismo que la pantalla está ayudando a contestar. 40 vueltas es el techo:
    // el Ritual entero son 15 datos, así que si esto llega al límite es que una
    // fase dejó de avanzar.
    for (let vuelta = 0; vuelta < 40; vuelta++) {
      const sesion = await cargarSesion(ctx);
      if (!sesion || sesion.status === 'completada') break;

      const clave = primerFaltante(sesion.fase, sesion.estado);
      if (!clave) throw new Error(`la fase '${sesion.fase}' no pide nada y no cerró`);

      const dicho = loQueContesta(clave);
      tocados.push(clave);

      agente.guion(comoLoMarcaria(clave, dicho));
      // La fase que cierra la última pregunta dispara además la síntesis, que
      // corre una segunda vez el modelo para narrar el mapa.
      if (clave === 'hito_del_diablo' || clave === 'dolores') {
        agente.guion('Aquí está tu Mapa de Negocio. Empieza por Ventas.');
      }

      await responder(ctx, dicho);
    }

    const foto = await fotoDelRitual(ctx);

    expect(foto.vista.status).toBe('completada');
    expect(foto.vista.progreso).toBe(100);
    expect(foto.mapa).not.toBeNull();
    expect(foto.mapa?.areas.length).toBeGreaterThan(0);

    // El orden real, y es el que promete el producto: lo de un toque primero.
    expect(tocados.slice(0, 5)).toEqual(['agente', 'categoria', 'equipo', 'giro', 'etapa']);

    // Y de las 15 respuestas, la mayoría fueron botones y no párrafos.
    const conBoton = tocados.filter((c) => (ayudaDe(c)?.opciones.length ?? 0) > 0);
    expect(conBoton.length).toBeGreaterThanOrEqual(6);
  });
});

describe('salirse después de la fase esencial ya deja algo construido', () => {
  it('cuatro toques y la empresa ya tiene giro sembrado y agente que la conoce', async () => {
    const ctx = ctxDePrueba();

    agente.guion('Hola, ¿cómo me llamo?');
    await iniciar(ctx);

    for (const clave of ['agente', 'categoria', 'equipo', 'giro', 'etapa']) {
      const dicho = clave === 'giro' ? 'restaurante de comida corrida' : loQueContesta(clave);
      agente.guion(comoLoMarcaria(clave, dicho));
      await responder(ctx, dicho);
    }

    // ── Aquí se levanta y se va. La entrevista está a la mitad. ─────────────
    const sesion = await cargarSesion(ctx);
    expect(sesion?.fase).toBe('modelo');
    expect(sesion?.status).not.toBe('completada');

    // Y aun así su empresa YA no está en blanco: el giro quedó sembrado, que es
    // lo que hace que su panel deje de ser genérico.
    const tenant = db.filas('tenants')[0] as { industry_type?: string; stage?: string } | undefined;
    expect(tenant?.industry_type).toBe('restaurante');
    expect(tenant?.stage).toBeTruthy();

    // Y su agente maestro ya sabe a qué se dedica: no es el prompt de fábrica.
    const maestro = agente.definiciones.filter((d) => d.role === 'master').at(-1);
    expect(maestro?.name).toBe('Sol');
    expect(maestro?.systemPrompt).toContain('restaurante de comida corrida');
  });

  it('el agente ve los mismos botones que el invitado, no otros', async () => {
    // Es el defecto silencioso que este diseño cierra: la pantalla pinta una
    // lista y el guion describe otra. Se ve perfecto y el agente pregunta lo
    // que no es.
    const ctx = ctxDePrueba();

    agente.guion('Hola, ¿cómo me llamo?');
    await iniciar(ctx);

    agente.guion(comoLoMarcaria('agente', 'Sol'));
    await responder(ctx, 'Sol');

    // Un turno más, ya dentro de la fase esencial y sin marcar nada: es el
    // turno en el que el agente TIENE que preguntar por la categoría, así que
    // es su guion el que debe describir los botones de la categoría.
    agente.guion('Ahorita te pregunto.');
    await responder(ctx, 'ok');

    const suffix = agente.ultima().systemSuffix;
    const foto = await fotoDelRitual(ctx);

    expect(foto.vista.ayuda?.clave).toBe('categoria');
    expect(foto.vista.ayuda?.opciones.length).toBeGreaterThan(0);

    expect(suffix).toContain('LO QUE ÉL VE EN PANTALLA AHORA');
    for (const opcion of foto.vista.ayuda?.opciones ?? []) {
      expect(suffix).toContain(opcion.etiqueta);
    }
    // Y se le prohíbe repetirlos: el invitado ya los está viendo.
    expect(suffix).toContain('No los enumeres');
  });
});
