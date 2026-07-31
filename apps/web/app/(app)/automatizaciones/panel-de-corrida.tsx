'use client';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El panel en vivo: ver la corrida ocurrir, paso por paso.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es la diferencia entre "confío en que sirve" y "lo vi funcionar", y es el
 *  criterio #3 del handoff.
 *
 *  ── Este componente NO SABE cómo llegan los datos ──────────────────────────
 *
 *  Recibe `seguir` por prop —con el adaptador de navegador por defecto— y lo
 *  único que hace con él es llamarlo y guardar lo que le devuelva. No hay un
 *  `fetch`, ni un intervalo, ni una mención al segundo en todo el archivo.
 *
 *  Por eso `packages/flows/src/ui/suscripcion.test.ts` puede sustituir el
 *  transporte entero por un arreglo en memoria y comprobar que llega lo mismo:
 *  el día que haya `LISTEN`/`NOTIFY`, este archivo no cambia.
 */
import { useEffect, useState } from 'react';
import type { RunSnapshot, StepStatus } from '@abraxa/flows/ui';
import { definicionDe } from '@abraxa/flows/ui';
import { seguirCorrida } from './transporte';

export interface PanelDeCorridaProps {
  runId: string;
  /** Sustituible: es lo que hace que la UI no conozca el transporte. */
  seguir?: typeof seguirCorrida;
  alCerrar?: () => void;
}

const COLOR: Record<StepStatus, string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-300',
  skipped: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  waiting: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
};

const LEYENDA: Record<StepStatus, string> = {
  ok: 'listo',
  failed: 'falló',
  skipped: 'se saltó',
  waiting: 'esperando',
};

const ESTADO_DE_CORRIDA: Record<string, string> = {
  running: 'corriendo',
  waiting: 'esperando',
  paused: 'en pausa',
  completed: 'terminada',
  exited: 'terminada',
  error: 'se detuvo',
};

export function PanelDeCorrida({ runId, seguir = seguirCorrida, alCerrar }: PanelDeCorridaProps) {
  const [foto, setFoto] = useState<RunSnapshot | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  useEffect(() => {
    setFoto(null);
    setFallo(null);
    // Todo el transporte, en esta línea. Y su cancelación, en el return.
    return seguir(
      runId,
      (f) => {
        setFoto(f);
        setFallo(null);
      },
      (e) => setFallo(e instanceof Error ? e.message : 'No se pudo leer la corrida'),
    );
  }, [runId, seguir]);

  const enVivo = foto !== null && (foto.run.status === 'running' || foto.run.status === 'waiting');

  return (
    <section className="rounded-lg border border-border bg-card/40 p-4" aria-live="polite">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              enVivo ? 'animate-pulse bg-emerald-400' : 'bg-muted-foreground/50'
            }`}
            aria-hidden
          />
          <h3 className="text-sm font-medium">
            {foto ? `La corrida está ${ESTADO_DE_CORRIDA[foto.run.status] ?? foto.run.status}` : 'Cargando la corrida…'}
          </h3>
          {foto?.run.isTest && (
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
              prueba
            </span>
          )}
        </div>
        {alCerrar && (
          <button
            type="button"
            onClick={alCerrar}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            cerrar
          </button>
        )}
      </header>

      {fallo && (
        <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {fallo} — se sigue intentando.
        </p>
      )}

      {foto?.run.error && (
        <p className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {foto.run.error}
        </p>
      )}

      <ol className="space-y-2">
        {(foto?.steps ?? []).map((paso) => {
          const def = definicionDe(paso.nodeType);
          const salida = Object.entries(paso.output).filter(([, v]) => v !== null && v !== '');
          return (
            <li key={paso.id} className={`rounded border px-3 py-2 text-xs ${COLOR[paso.status]}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{def?.etiqueta ?? paso.nodeType}</span>
                <span className="opacity-80">{LEYENDA[paso.status]}</span>
              </div>
              {paso.error && <p className="mt-1 opacity-90">{paso.error}</p>}
              {salida.length > 0 && (
                <dl className="mt-1 space-y-0.5 opacity-80">
                  {salida.slice(0, 4).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="shrink-0">{k}:</dt>
                      <dd className="truncate">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}

        {foto && foto.steps.length === 0 && (
          <li className="rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            Todavía no hay pasos. Si no se mueve en unos segundos, es que no hay quien ejecute la
            cola.
          </li>
        )}
      </ol>

      {enVivo && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Actualizando en vivo. Se detiene solo cuando termina, y también si dejas esta pestaña.
        </p>
      )}
    </section>
  );
}
