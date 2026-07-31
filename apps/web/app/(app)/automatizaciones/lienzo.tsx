'use client';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El lienzo: los pasos del flujo, como los ve el emprendedor.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  React Flow (`@xyflow/react`, ya instalado por H1) pinta el grafo; los nodos
 *  se pintan aquí para que se vean como el resto del producto y para que cada
 *  paso muestre lo que de verdad va a hacer —el mensaje que manda, la etapa a
 *  la que mueve— y no sólo su tipo.
 *
 *  ── Un nodo que está corriendo se ve corriendo ─────────────────────────────
 *
 *  `estados` mapea id de paso → cómo salió. Cuando el panel en vivo recibe una
 *  foto, el lienzo se pinta con ella: el emprendedor ve el mismo grafo que
 *  editó, encendiéndose paso por paso. Es lo que separa "confío en que sirve"
 *  de "lo vi funcionar".
 */
import { useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowDefinition, StepStatus } from '@abraxa/flows/ui';
import { definicionDe } from '@abraxa/flows/ui';

export type EstadosDePaso = Record<string, StepStatus | 'corriendo'>;

const BORDE: Record<StepStatus | 'corriendo', string> = {
  ok: 'border-emerald-500/60 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]',
  failed: 'border-red-500/60 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]',
  skipped: 'border-amber-500/50',
  waiting: 'border-sky-500/50',
  corriendo: 'border-emerald-400 animate-pulse',
};

interface DatosDeNodo extends Record<string, unknown> {
  etiqueta: string;
  resumen: string;
  tipo: string;
  estado?: StepStatus | 'corriendo';
  bifurca?: boolean;
  esInicio?: boolean;
  esFin?: boolean;
}

/** Un paso. Enseña lo que hace, no cómo se llama su tipo. */
function Paso({ data, selected }: NodeProps) {
  const d = data as DatosDeNodo;
  return (
    <div
      className={`w-60 rounded-lg border bg-card px-3 py-2 text-left transition-colors ${
        d.estado ? BORDE[d.estado] : selected ? 'border-primary' : 'border-border'
      }`}
    >
      {!d.esInicio && <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />}
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{d.etiqueta}</p>
      <p className="mt-0.5 truncate text-sm text-foreground">{d.resumen}</p>

      {d.bifurca ? (
        <>
          <Handle
            type="source"
            id="yes"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className="!bg-emerald-500"
          />
          <Handle
            type="source"
            id="no"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className="!bg-red-500"
          />
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>sí</span>
            <span>no</span>
          </div>
        </>
      ) : (
        !d.esFin && <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
      )}
    </div>
  );
}

const TIPOS_PINTADOS = { paso: Paso };

/** Lo que el nodo va a hacer, en una línea. */
function resumenDe(tipo: string, config: Record<string, unknown>): string {
  const t = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
  switch (tipo) {
    case 'send_message':
      return t(config.template) || `mandar un ${t(config.channel) || 'mensaje'}`;
    case 'wait':
      return `esperar ${t(config.minutes) || '?'} min`;
    case 'condition':
      return `si ${t(config.field)} ${t(config.op) || 'es'} ${t(config.value)}`;
    case 'move_stage':
      return `mover a ${t(config.stage) || '?'}`;
    case 'add_tag':
      return `etiquetar ${t(config.tag) || '?'}`;
    case 'assign_owner':
      return t(config.owner_email) || 'repartir en el equipo';
    case 'create_task':
      return t(config.title) || 'crear una tarea';
    case 'webhook':
      return t(config.url) || 'llamar a otro sistema';
    case 'ai_step':
      return t(config.prompt) || 'preguntarle a un agente';
    default:
      return definicionDe(tipo)?.resumen ?? tipo;
  }
}

export interface LienzoProps {
  definicion: FlowDefinition;
  estados?: EstadosDePaso;
  seleccionado?: string | null;
  alSeleccionar?: (id: string | null) => void;
  alMover?: (id: string, position: { x: number; y: number }) => void;
}

export function Lienzo({
  definicion,
  estados = {},
  seleccionado,
  alSeleccionar,
  alMover,
}: LienzoProps) {
  const nodos: Node[] = useMemo(
    () =>
      definicion.nodes.map((n, i) => {
        const def = definicionDe(n.type);
        const config = (n.data?.config ?? {}) as Record<string, unknown>;
        const estado = estados[n.id];
        return {
          id: n.id,
          type: 'paso',
          position: n.position ?? { x: 0, y: i * 140 },
          selected: seleccionado === n.id,
          data: {
            etiqueta: def?.etiqueta ?? n.type,
            resumen: n.type === 'trigger' ? (n.data?.label ?? 'cuando pase algo') : resumenDe(n.type, config),
            tipo: n.type,
            ...(estado ? { estado } : {}),
            ...(def?.bifurca ? { bifurca: true } : {}),
            ...(n.type === 'trigger' ? { esInicio: true } : {}),
            ...(def?.termina ? { esFin: true } : {}),
          } satisfies DatosDeNodo,
        };
      }),
    [definicion, estados, seleccionado],
  );

  const aristas: Edge[] = useMemo(
    () =>
      definicion.edges.map((e, i) => ({
        id: e.id ?? `e-${i}`,
        source: e.source,
        target: e.target,
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
        ...(e.sourceHandle ? { label: e.sourceHandle === 'yes' ? 'sí' : 'no' } : {}),
        animated: estados[e.source] === 'corriendo',
      })),
    [definicion, estados],
  );

  return (
    <div className="h-[520px] w-full overflow-hidden rounded-lg border border-border bg-background/40">
      <ReactFlow
        nodes={nodos}
        edges={aristas}
        nodeTypes={TIPOS_PINTADOS}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => alSeleccionar?.(n.id)}
        onPaneClick={() => alSeleccionar?.(null)}
        onNodeDragStop={(_, n) => alMover?.(n.id, n.position)}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
