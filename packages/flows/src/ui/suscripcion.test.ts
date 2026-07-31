/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Criterio #3 — verlo ocurrir, y las dos cosas donde esto se cae.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Que el panel se actualice es lo fácil. Lo que de verdad hay que probar es
 *  que el reloj se APAGA:
 *
 *    · cuando la corrida termina — si no, es una petición por segundo, para
 *      siempre, por cada pestaña abierta;
 *    · cuando la pestaña se oculta — una pestaña olvidada un fin de semana son
 *      ~170 000 peticiones y una factura que nadie sabe explicar.
 *
 *  Y que la UI no sepa cómo llegan los datos: aquí `pedir` se sustituye
 *  entera y nada más cambia.
 *
 *  Todo corre con un reloj falso, en milisegundos, sin navegador y sin red.
 */
import { describe, expect, it } from 'vitest';
import { suscribirseACorrida } from './suscripcion';
import type { Reloj, Visibilidad } from './suscripcion';
import type { RunSnapshot, RunStatus } from '../types';

/** Un reloj falso: los temporizadores sólo avanzan cuando se le dice. */
function relojFalso() {
  let siguiente = 1;
  const pendientes = new Map<number, { fn: () => void; ms: number }>();

  const reloj: Reloj = {
    programar(fn, ms) {
      const id = siguiente++;
      pendientes.set(id, { fn, ms });
      return id;
    },
    cancelar(id) {
      pendientes.delete(id as number);
    },
  };

  return {
    reloj,
    get programados() {
      return pendientes.size;
    },
    /** Últimos milisegundos pedidos. Sirve para comprobar el intervalo. */
    ultimaEspera(): number | null {
      const ultimo = [...pendientes.values()].pop();
      return ultimo?.ms ?? null;
    },
    /** Dispara todos los temporizadores pendientes una vez. */
    async avanzar(): Promise<void> {
      const disparar = [...pendientes.entries()];
      pendientes.clear();
      for (const [, t] of disparar) t.fn();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function visibilidadFalsa(inicial = true) {
  let visible = inicial;
  const oyentes: Array<() => void> = [];
  const v: Visibilidad = {
    visible: () => visible,
    alCambiar(cb) {
      oyentes.push(cb);
      return () => {
        const i = oyentes.indexOf(cb);
        if (i >= 0) oyentes.splice(i, 1);
      };
    },
  };
  return {
    visibilidad: v,
    get oyentes() {
      return oyentes.length;
    },
    async poner(nuevo: boolean): Promise<void> {
      visible = nuevo;
      for (const cb of [...oyentes]) cb();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const foto = (status: RunStatus, pasos = 0): RunSnapshot =>
  ({
    run: {
      id: 'r1',
      flowId: 'f1',
      version: 1,
      contactId: 'c1',
      status,
      currentNode: 'n1',
      context: {},
      triggerType: 'contact_created',
      isTest: false,
      error: null,
      startedAt: '2026-07-31T00:00:00.000Z',
      wakeAt: null,
      completedAt: null,
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
    steps: Array.from({ length: pasos }, (_, i) => ({
      id: `s${i}`,
      runId: 'r1',
      nodeId: `n${i}`,
      nodeType: 'send_message' as const,
      status: 'ok' as const,
      input: {},
      output: {},
      error: null,
      startedAt: '2026-07-31T00:00:00.000Z',
      completedAt: null,
    })),
  }) as RunSnapshot;

const esperar = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('suscribirseACorrida', () => {
  it('pide la primera foto de inmediato, sin esperar el primer tic', async () => {
    const t = relojFalso();
    const recibidas: RunSnapshot[] = [];
    let llamadas = 0;

    suscribirseACorrida(
      'r1',
      (f) => recibidas.push(f),
      {
        pedir: () => {
          llamadas += 1;
          return Promise.resolve(foto('running'));
        },
        reloj: t.reloj,
      },
    );
    await esperar();

    expect(llamadas).toBe(1);
    expect(recibidas).toHaveLength(1);
  });

  it('sigue pidiendo cada segundo mientras la corrida vive', async () => {
    const t = relojFalso();
    let llamadas = 0;
    suscribirseACorrida('r1', () => undefined, {
      pedir: () => {
        llamadas += 1;
        return Promise.resolve(foto('running'));
      },
      reloj: t.reloj,
    });
    await esperar();
    expect(t.ultimaEspera()).toBe(1000); // un segundo, no diez

    await t.avanzar();
    await esperar();
    expect(llamadas).toBe(2);

    await t.avanzar();
    await esperar();
    expect(llamadas).toBe(3);
  });

  it('SE APAGA SOLA cuando la corrida llega a un estado terminal', async () => {
    for (const terminal of ['completed', 'error', 'exited'] as const) {
      const t = relojFalso();
      let llamadas = 0;
      let terminada: RunSnapshot | null = null;

      suscribirseACorrida('r1', () => undefined, {
        pedir: () => {
          llamadas += 1;
          return Promise.resolve(foto(llamadas >= 2 ? terminal : 'running'));
        },
        reloj: t.reloj,
        alTerminar: (f) => {
          terminada = f;
        },
      });
      await esperar();
      await t.avanzar();
      await esperar();

      expect(llamadas).toBe(2);
      expect(terminada).not.toBeNull();
      // Y lo que importa: no queda NADA programado.
      expect(t.programados).toBe(0);

      await t.avanzar();
      await esperar();
      expect(llamadas).toBe(2); // ni una petición más
    }
  });

  it('SE DETIENE con la pestaña oculta y se pone al día al volver', async () => {
    const t = relojFalso();
    const v = visibilidadFalsa(true);
    let llamadas = 0;

    suscribirseACorrida('r1', () => undefined, {
      pedir: () => {
        llamadas += 1;
        return Promise.resolve(foto('running'));
      },
      reloj: t.reloj,
      visibilidad: v.visibilidad,
    });
    await esperar();
    expect(llamadas).toBe(1);

    await v.poner(false);
    expect(t.programados).toBe(0); // el reloj se apagó

    await t.avanzar();
    await esperar();
    expect(llamadas).toBe(1); // oculta: no se pide nada

    // Al volver, la foto de inmediato — sin esperar el siguiente tic.
    await v.poner(true);
    expect(llamadas).toBe(2);
    expect(t.programados).toBe(1); // y el reloj vuelve a andar
  });

  it('cancelar deja de pedir y suelta el oyente de visibilidad', async () => {
    const t = relojFalso();
    const v = visibilidadFalsa();
    let llamadas = 0;

    const cancelar = suscribirseACorrida('r1', () => undefined, {
      pedir: () => {
        llamadas += 1;
        return Promise.resolve(foto('running'));
      },
      reloj: t.reloj,
      visibilidad: v.visibilidad,
    });
    await esperar();
    expect(v.oyentes).toBe(1);

    cancelar();
    expect(t.programados).toBe(0);
    expect(v.oyentes).toBe(0);

    await t.avanzar();
    await esperar();
    expect(llamadas).toBe(1);
  });

  it('una respuesta que llega TARDE, después de cancelar, no toca la UI', async () => {
    // Pintar sobre un componente desmontado es un error de React y un dato
    // sobre una pantalla que ya no existe.
    const t = relojFalso();
    let resolver: ((f: RunSnapshot) => void) | null = null;
    let recibidas = 0;

    const cancelar = suscribirseACorrida('r1', () => (recibidas += 1), {
      pedir: () =>
        new Promise<RunSnapshot>((res) => {
          resolver = res;
        }),
      reloj: t.reloj,
    });

    cancelar();
    resolver?.(foto('running'));
    await esperar();

    expect(recibidas).toBe(0);
  });

  it('ante un error avisa, no se muere, y espera cada vez más', async () => {
    const t = relojFalso();
    const fallos: unknown[] = [];
    let llamadas = 0;

    suscribirseACorrida('r1', () => undefined, {
      pedir: () => {
        llamadas += 1;
        return Promise.reject(new Error('la API no contestó'));
      },
      reloj: t.reloj,
      alFallar: (e) => fallos.push(e),
    });
    await esperar();
    expect(fallos).toHaveLength(1);
    expect(t.ultimaEspera()).toBe(2000); // 1s × 2

    await t.avanzar();
    await esperar();
    expect(t.ultimaEspera()).toBe(4000);

    await t.avanzar();
    await esperar();
    expect(t.ultimaEspera()).toBe(8000);
    expect(llamadas).toBe(3); // sigue viva
  });

  it('se recupera: tras un error, una respuesta buena vuelve al segundo', async () => {
    const t = relojFalso();
    let llamadas = 0;
    suscribirseACorrida('r1', () => undefined, {
      pedir: () => {
        llamadas += 1;
        return llamadas === 1
          ? Promise.reject(new Error('caída'))
          : Promise.resolve(foto('running'));
      },
      reloj: t.reloj,
    });
    await esperar();
    expect(t.ultimaEspera()).toBe(2000);

    await t.avanzar();
    await esperar();
    expect(t.ultimaEspera()).toBe(1000);
  });

  it('no encima dos peticiones si una tarda más que el intervalo', async () => {
    const t = relojFalso();
    let enVuelo = 0;
    let maximo = 0;

    suscribirseACorrida('r1', () => undefined, {
      pedir: () => {
        enVuelo += 1;
        maximo = Math.max(maximo, enVuelo);
        return new Promise<RunSnapshot>((res) =>
          setTimeout(() => {
            enVuelo -= 1;
            res(foto('running'));
          }, 0),
        );
      },
      reloj: t.reloj,
    });

    await t.avanzar();
    await t.avanzar();
    await esperar();
    expect(maximo).toBe(1);
  });
});

describe('el transporte es sustituible: la UI no sabe cómo llegan los datos', () => {
  it('con una fuente que no es red, el panel recibe exactamente lo mismo', async () => {
    // Es la prueba del criterio #3: `pedir` aquí lee de un arreglo en memoria.
    // Ni una línea de la UI cambia — recibe fotos por su callback y ya.
    const guion = [foto('running', 1), foto('running', 2), foto('completed', 3)];
    const t = relojFalso();
    const vistas: number[] = [];
    let i = 0;

    suscribirseACorrida('r1', (f) => vistas.push(f.steps.length), {
      pedir: () => Promise.resolve(guion[Math.min(i++, guion.length - 1)]!),
      reloj: t.reloj,
    });

    await esperar();
    await t.avanzar();
    await esperar();
    await t.avanzar();
    await esperar();

    expect(vistas).toEqual([1, 2, 3]);
    expect(t.programados).toBe(0); // terminó y se apagó
  });
});
