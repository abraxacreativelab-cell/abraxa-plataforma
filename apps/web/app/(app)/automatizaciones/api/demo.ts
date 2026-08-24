/**
 * El juego de datos de demostración. Apagado por partida doble (ver `bff.ts`).
 *
 * Existe para poder VER la pantalla —y el panel en vivo moviéndose— antes de
 * que H18 entregue la sesión. No toca la base ni finge que la tocó: la
 * corrida avanza sola en memoria, un paso por segundo, para que se pueda
 * comprobar a ojo lo que las pruebas comprueban en milisegundos.
 */
import type { Flow, FlowRun, FlowStep, RunSnapshot } from '@abraxa/flows';

const AHORA = '2026-07-31T18:00:00.000Z';

export const FLUJO_DEMO: Flow = {
  id: 'demo-1',
  name: 'Lead nuevo por la página',
  description: 'Le manda un WhatsApp, lo etiqueta y lo mueve a Contactado.',
  triggerType: 'contact_created',
  triggerConfig: {},
  definition: {
    nodes: [
      { id: 'inicio', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Entra un contacto nuevo' } },
      {
        id: 'saludo',
        type: 'send_message',
        position: { x: 0, y: 140 },
        data: {
          label: 'Saludarlo',
          config: { channel: 'whatsapp', to: 'contact', template: 'Hola {nombre}, ¡gracias por escribirnos!' },
        },
      },
      {
        id: 'etiqueta',
        type: 'add_tag',
        position: { x: 0, y: 280 },
        data: { label: 'Marcarlo', config: { tag: 'lead-nuevo' } },
      },
      {
        id: 'mover',
        type: 'move_stage',
        position: { x: 0, y: 420 },
        data: { label: 'Moverlo en el embudo', config: { stage: 'contactado' } },
      },
      { id: 'fin', type: 'end', position: { x: 0, y: 560 }, data: { label: 'Listo' } },
    ],
    edges: [
      { id: 'e1', source: 'inicio', target: 'saludo' },
      { id: 'e2', source: 'saludo', target: 'etiqueta' },
      { id: 'e3', source: 'etiqueta', target: 'mover' },
      { id: 'e4', source: 'mover', target: 'fin' },
    ],
  },
  status: 'paused',
  version: 1,
  createdBy: 'santiago@abraxa.club',
  activatedBy: null,
  activatedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
};

const ORDEN = ['saludo', 'etiqueta', 'mover', 'fin'] as const;

const SALIDAS: Record<string, Record<string, unknown>> = {
  saludo: { canal: 'whatsapp', para: '+52 81 4681 1675', vistaPrevia: 'Hola Ana, ¡gracias por escribirnos!' },
  etiqueta: { etiqueta: 'lead-nuevo', nueva: true },
  mover: { movido: true, etapa: 'contactado' },
  fin: { razon: 'el flujo llegó a su fin' },
};

/** Arranque de la corrida falsa, para que avance con el reloj de pared. */
let arrancoEn: number | null = null;

/**
 * Una corrida que avanza un paso por segundo. Es lo que hace visible el
 * polling de 1 s sin base ni worker: se abre la pantalla y se ven los pasos
 * encenderse uno tras otro.
 */
export function corridaDemo(): RunSnapshot {
  arrancoEn ??= Date.now();
  const transcurridos = Math.floor((Date.now() - arrancoEn) / 1000);
  const hechos = Math.min(transcurridos, ORDEN.length);

  const steps: FlowStep[] = ORDEN.slice(0, hechos).map((nodeId, i) => ({
    id: `paso-${i}`,
    runId: 'corrida-demo',
    nodeId,
    nodeType: FLUJO_DEMO.definition.nodes.find((n) => n.id === nodeId)!.type,
    status: 'ok',
    input: {},
    output: SALIDAS[nodeId] ?? {},
    error: null,
    startedAt: new Date((arrancoEn ?? 0) + i * 1000).toISOString(),
    completedAt: new Date((arrancoEn ?? 0) + i * 1000 + 400).toISOString(),
  }));

  const termino = hechos >= ORDEN.length;
  const run: FlowRun = {
    id: 'corrida-demo',
    flowId: FLUJO_DEMO.id,
    version: 1,
    contactId: 'contacto-demo',
    status: termino ? 'exited' : 'running',
    currentNode: termino ? 'fin' : (ORDEN[hechos] ?? 'saludo'),
    context: { contactId: 'contacto-demo', event: 'contact_created' },
    triggerType: 'contact_created',
    isTest: true,
    error: null,
    stepsTaken: hechos,
    startedAt: new Date(arrancoEn ?? 0).toISOString(),
    wakeAt: null,
    completedAt: termino ? new Date((arrancoEn ?? 0) + 4000).toISOString() : null,
    updatedAt: new Date().toISOString(),
  };

  return { run, steps };
}

/** Vuelve a empezar la corrida falsa. Lo llama el botón "Probar" en demo. */
export function reiniciarDemo(): void {
  arrancoEn = Date.now();
}

export const listaDemo = (): Flow[] => [FLUJO_DEMO];
export const corridasDemo = (): FlowRun[] => [corridaDemo().run];
