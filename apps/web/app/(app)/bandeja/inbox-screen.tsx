'use client';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La bandeja. Lista de hilos, conversación y compositor.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Tres cosas la definen, y las tres están en el handoff:
 *
 *  1. **El interruptor de IA por hilo, visible y obvio.** El emprendedor tiene
 *     que poder callar a su agente en un clic cuando quiera meterse él. No está
 *     escondido en un menú: es un botón con estado en la cabecera del hilo.
 *
 *  2. **Envío optimista.** El mensaje aparece como `queued` y se confirma
 *     después. Si falla, la burbuja queda marcada — no desaparece dejando al
 *     usuario sin saber si se mandó.
 *
 *  3. **Estados honestos.** `AsyncBoundary` de H5 hace estructuralmente
 *     imposible pintar "no hay conversaciones" cuando en realidad la petición
 *     murió. Cargando, error, vacío y contenido son cuatro cosas distintas.
 */
import * as React from 'react';
import {
  AsyncBoundary,
  Badge,
  Button,
  EmptyState,
  Icon,
  Textarea,
  cn,
  toLoadFailure,
  type AsyncState,
} from '@abraxa/ui';
import {
  ETIQUETA_CANAL,
  ICONO_CANAL,
  fechaCorta,
  hora,
  ordenarHilos,
  type Conversacion,
  type Hilo,
  type Mensaje,
} from './tipos';

const BASE = '/bandeja/api';

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${ruta}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw res;
  return (await res.json()) as T;
}

export default function InboxScreen() {
  const [lista, setLista] = React.useState<AsyncState<Hilo[]>>({ status: 'loading' });
  const [activo, setActivo] = React.useState<string | null>(null);
  const [conversacion, setConversacion] = React.useState<AsyncState<Conversacion> | null>(null);
  const [optimistas, setOptimistas] = React.useState<Mensaje[]>([]);

  const cargarLista = React.useCallback(async () => {
    setLista({ status: 'loading' });
    try {
      const r = await pedir<{ threads: Hilo[] }>('/hilos');
      setLista({ status: 'ready', data: ordenarHilos(r.threads ?? []) });
    } catch (e) {
      setLista({ status: 'error', failure: toLoadFailure(e) });
    }
  }, []);

  const cargarHilo = React.useCallback(async (id: string) => {
    setConversacion({ status: 'loading' });
    setOptimistas([]);
    try {
      const c = await pedir<Conversacion>(`/hilos/${encodeURIComponent(id)}`);
      setConversacion({ status: 'ready', data: c });
    } catch (e) {
      setConversacion({ status: 'error', failure: toLoadFailure(e) });
    }
  }, []);

  React.useEffect(() => {
    void cargarLista();
  }, [cargarLista]);

  React.useEffect(() => {
    if (activo) void cargarHilo(activo);
  }, [activo, cargarHilo]);

  /** Refleja en la lista lo que cambió en el hilo abierto, sin recargar todo. */
  const refrescarEnLista = React.useCallback((h: Hilo) => {
    setLista((prev) =>
      prev.status === 'ready'
        ? { status: 'ready', data: ordenarHilos(prev.data.map((x) => (x.id === h.id ? h : x))) }
        : prev,
    );
  }, []);

  return (
    <main className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1400px] flex-col px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bandeja</h1>
          <p className="text-sm text-muted-foreground">
            Tu agente contesta a tus clientes. Y se calla en cuanto tomas el hilo.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void cargarLista()}>
          <Icon name="refresh" className="h-4 w-4" />
          Actualizar
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <section
          className={cn(
            'min-h-0 overflow-y-auto rounded-lg border border-border bg-card/30',
            activo && 'hidden lg:block',
          )}
          aria-label="Conversaciones"
        >
          <AsyncBoundary
            state={lista}
            onRetry={() => void cargarLista()}
            empty={
              <EmptyState
                className="m-3 border-0"
                icon="inbox"
                title="Aún no hay conversaciones"
                description="En cuanto conectes un canal y alguien te escriba, aparecerá aquí."
              />
            }
          >
            {(hilos) => (
              <ul className="divide-y divide-border">
                {hilos.map((h) => (
                  <li key={h.id}>
                    <FilaHilo hilo={h} activo={h.id === activo} onAbrir={() => setActivo(h.id)} />
                  </li>
                ))}
              </ul>
            )}
          </AsyncBoundary>
        </section>

        <section
          className={cn(
            'flex min-h-0 flex-col rounded-lg border border-border bg-card/30',
            !activo && 'hidden lg:flex',
          )}
          aria-label="Conversación"
        >
          {!activo || !conversacion ? (
            <div className="grid flex-1 place-items-center p-8">
              <EmptyState
                className="border-0"
                icon="messages"
                title="Elige una conversación"
                description="Aquí verás el hilo completo y podrás escribirle tú."
              />
            </div>
          ) : (
            <AsyncBoundary
              state={conversacion}
              onRetry={() => void cargarHilo(activo)}
              isEmpty={() => false}
            >
              {(c) => (
                <Panel
                  conversacion={c}
                  optimistas={optimistas}
                  onVolver={() => setActivo(null)}
                  onCambio={(nuevo) => {
                    setConversacion({ status: 'ready', data: nuevo });
                    refrescarEnLista(nuevo.thread);
                  }}
                  onOptimista={setOptimistas}
                />
              )}
            </AsyncBoundary>
          )}
        </section>
      </div>
    </main>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function FilaHilo({
  hilo,
  activo,
  onAbrir,
}: {
  hilo: Hilo;
  activo: boolean;
  onAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-current={activo ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60',
        activo && 'bg-secondary',
      )}
    >
      <Icon
        name={ICONO_CANAL[hilo.channelType] ?? 'messages'}
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{hilo.display}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {fechaCorta(hilo.lastMessageAt)}
          </span>
        </span>

        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {hilo.lastDirection === 'out' && <span className="text-muted-foreground/60">Tú: </span>}
          {hilo.lastMessage ?? 'Sin mensajes'}
        </span>

        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{ETIQUETA_CANAL[hilo.channelType] ?? hilo.channelType}</Badge>
          {hilo.assignedTo ? (
            <Badge variant="info">Lo llevas tú</Badge>
          ) : hilo.aiEnabled ? (
            <Badge variant="success">IA activa</Badge>
          ) : (
            <Badge variant="warning">IA en pausa</Badge>
          )}
          {hilo.unread > 0 && <Badge variant="default">{hilo.unread}</Badge>}
        </span>
      </span>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function Panel({
  conversacion,
  optimistas,
  onVolver,
  onCambio,
  onOptimista,
}: {
  conversacion: Conversacion;
  optimistas: Mensaje[];
  onVolver: () => void;
  onCambio: (c: Conversacion) => void;
  onOptimista: React.Dispatch<React.SetStateAction<Mensaje[]>>;
}) {
  const { thread } = conversacion;
  const [texto, setTexto] = React.useState('');
  const [mandando, setMandando] = React.useState(false);
  const [cambiandoIA, setCambiandoIA] = React.useState(false);
  const finRef = React.useRef<HTMLDivElement>(null);

  const mensajes = React.useMemo(
    () => [...conversacion.messages, ...optimistas],
    [conversacion.messages, optimistas],
  );

  React.useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' });
  }, [mensajes.length]);

  /**
   * Envío optimista: la burbuja aparece en `queued` y se confirma después.
   * Si falla, se marca `failed` en vez de desaparecer — el usuario tiene que
   * poder ver que su mensaje no salió.
   */
  async function mandar() {
    const cuerpo = texto.trim();
    if (!cuerpo || mandando) return;

    const provisional: Mensaje = {
      id: `optimista-${Date.now()}`,
      thread_id: thread.id,
      direction: 'out',
      body: cuerpo,
      media: [],
      ai_generated: false,
      author: thread.assignedTo ?? 'tú',
      status: 'queued',
      error: null,
      ai_outcome: null,
      ai_reason: null,
      created_at: new Date().toISOString(),
    };

    setTexto('');
    setMandando(true);
    onOptimista((prev) => [...prev, provisional]);

    try {
      const r = await pedir<{ message: Mensaje }>(
        `/hilos/${encodeURIComponent(thread.id)}/mensajes`,
        { method: 'POST', body: JSON.stringify({ body: cuerpo }) },
      );
      onOptimista((prev) =>
        prev.map((m) => (m.id === provisional.id ? { ...r.message, thread_id: thread.id } : m)),
      );
      // Escribir toma el hilo: la IA se calla. Se refleja de inmediato para que
      // el estado de la cabecera no mienta hasta la siguiente recarga.
      onCambio({ ...conversacion, thread: { ...thread, assignedTo: thread.assignedTo ?? 'tú' } });
    } catch {
      onOptimista((prev) =>
        prev.map((m) =>
          m.id === provisional.id ? { ...m, status: 'failed', error: 'No se pudo enviar' } : m,
        ),
      );
    } finally {
      setMandando(false);
    }
  }

  async function alternarIA() {
    setCambiandoIA(true);
    try {
      const c = await pedir<Conversacion>(`/hilos/${encodeURIComponent(thread.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ aiEnabled: !thread.aiEnabled }),
      });
      onCambio(c);
    } catch {
      /* La cabecera sigue mostrando el estado real; el usuario puede reintentar. */
    } finally {
      setCambiandoIA(false);
    }
  }

  async function devolverALaIA() {
    setCambiandoIA(true);
    try {
      const c = await pedir<Conversacion>(`/hilos/${encodeURIComponent(thread.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedTo: null }),
      });
      onCambio(c);
    } catch {
      /* idem */
    } finally {
      setCambiandoIA(false);
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onVolver} aria-label="Volver">
          <Icon name="chevron-right" className="h-4 w-4 rotate-180" />
        </Button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{thread.display}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {thread.address} · {ETIQUETA_CANAL[thread.channelType] ?? thread.channelType}
            {thread.channelName ? ` · ${thread.channelName}` : ''}
          </p>
        </div>

        {/* El control que tiene que estar a un clic. */}
        <div className="flex items-center gap-2">
          {thread.assignedTo && (
            <Button variant="outline" size="sm" onClick={() => void devolverALaIA()} disabled={cambiandoIA}>
              <Icon name="bot" className="h-4 w-4" />
              Devolver a la IA
            </Button>
          )}
          <Button
            variant={thread.aiEnabled ? 'default' : 'glass'}
            size="sm"
            onClick={() => void alternarIA()}
            disabled={cambiandoIA}
            aria-pressed={thread.aiEnabled}
          >
            <Icon name={thread.aiEnabled ? 'bot' : 'lock'} className="h-4 w-4" />
            {thread.aiEnabled ? 'IA activa' : 'IA en pausa'}
          </Button>
        </div>
      </header>

      {thread.assignedTo && (
        <p className="border-b border-border bg-[hsl(var(--color-info-bg))] px-4 py-2 text-xs text-[hsl(var(--color-info-fg))]">
          Tú llevas esta conversación ({thread.assignedTo}). Tu agente no se va a meter mientras sea
          así.
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {mensajes.length === 0 && (
          <EmptyState className="border-0" icon="messages" title="Sin mensajes todavía" />
        )}
        {mensajes.map((m) => (
          <Burbuja key={m.id} mensaje={m} />
        ))}
        <div ref={finRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void mandar();
              }
            }}
            rows={2}
            placeholder="Escribe… (al escribir tú, tu agente se calla en este hilo)"
            aria-label="Mensaje"
          />
          <Button onClick={() => void mandar()} disabled={mandando || texto.trim().length === 0}>
            <Icon name="arrow-right" className="h-4 w-4" />
            Enviar
          </Button>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function Burbuja({ mensaje }: { mensaje: Mensaje }) {
  const saliente = mensaje.direction === 'out';

  return (
    <div className={cn('flex flex-col gap-1', saliente ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[min(80%,42rem)] rounded-lg border px-3 py-2 text-sm',
          saliente
            ? 'border-primary/30 bg-primary/10'
            : 'border-border bg-secondary/60',
          mensaje.status === 'failed' && 'border-[hsl(var(--color-error-border))] bg-[hsl(var(--color-error-bg))]',
          mensaje.status === 'queued' && 'opacity-60',
        )}
      >
        {mensaje.body && <p className="whitespace-pre-wrap break-words">{mensaje.body}</p>}
        {mensaje.media.map((m) => (
          <a
            key={m.url}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate text-xs underline"
          >
            {m.type}
          </a>
        ))}
      </div>

      <div className="flex items-center gap-2 px-1 font-mono text-[10px] text-muted-foreground">
        {mensaje.ai_generated && <Badge variant="default">Agente</Badge>}
        <span>{hora(mensaje.created_at)}</span>
        {saliente && <EstadoEnvio mensaje={mensaje} />}
      </div>

      {/* Criterio #5: cuando la IA no contestó, aquí se ve POR QUÉ. */}
      {mensaje.ai_outcome === 'skipped' && mensaje.ai_reason && (
        <p className="px-1 text-[11px] italic text-muted-foreground/70">{mensaje.ai_reason}</p>
      )}
      {mensaje.ai_outcome === 'failed' && (
        <p className="px-1 text-[11px] text-[hsl(var(--color-warning-fg))]">
          Tu agente no pudo contestar este mensaje. Te toca a ti.
          {mensaje.ai_reason ? ` (${mensaje.ai_reason})` : ''}
        </p>
      )}
    </div>
  );
}

const COPY_ESTADO: Record<Mensaje['status'], string> = {
  queued: 'enviando…',
  sent: 'enviado',
  delivered: 'entregado',
  read: 'leído',
  failed: 'no se envió',
};

function EstadoEnvio({ mensaje }: { mensaje: Mensaje }) {
  return (
    <span className={cn(mensaje.status === 'failed' && 'text-[hsl(var(--color-error-fg))]')}>
      · {COPY_ESTADO[mensaje.status]}
      {mensaje.error ? ` (${mensaje.error})` : ''}
    </span>
  );
}
