'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { OnboardingView } from '@abraxa/areas';
import { AccentScope, Badge, Button, Card, Icon, Textarea, cn } from '@abraxa/ui';
import { empezar, responder, terminar } from '../actions';

/**
 * El mini-onboarding de un área (handoff §6).
 *
 * Los cuatro pasos, en una sola pantalla que avanza:
 *
 *   1. Qué es esta área en TU empresa      → `script.intro`
 *   2. Qué cambia cuando la tienes         → `script.promise`
 *   3. Tres preguntas — no veinte          → `script.questions`
 *   4. Un primer resultado visible         → `run.result`
 *
 * Ni un texto de tutorial está escrito aquí: TODO viene de
 * `app.area_catalog.script`, uno por área × giro. Escribir el guion de
 * restaurantes es un INSERT, y esta pantalla no se entera.
 *
 * ── Por qué el tutorial es opcional y se ve que lo es ──────────────────────
 *
 * Hay un "prefiero explorar solo" a la vista desde el primer paso. Un tutorial
 * del que no se puede salir es un formulario largo con otro nombre, y el área ya
 * está ganada: retenerla detrás de tres preguntas sería cobrarle dos veces.
 */
export function Tutorial({ inicial }: { inicial: OnboardingView }) {
  const [vista, setVista] = useState(inicial);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const aplicar = (accion: () => Promise<Awaited<ReturnType<typeof empezar>>>): void => {
    setError(null);
    iniciar(() => {
      void accion().then((r) => {
        if (!r.ok || !r.view) {
          setError(r.error);
          return;
        }
        setVista(r.view);
        setTexto('');
        setAviso(r.degraded ?? null);
      });
    });
  };

  const { script, run, question } = vista;
  const terminado = Boolean(run?.completedAt);
  const empezado = Boolean(run);

  return (
    <AccentScope area={vista.areaSlug}>
      <main className="mx-auto w-full max-w-2xl px-6 py-10 lg:py-16">
        <Link
          href="/mapa"
          className="mb-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="chevron-right" className="h-3 w-3 rotate-180" />
          Mapa de negocio
        </Link>

        <header className="mb-8">
          <Badge variant={terminado ? 'success' : 'default'} className="mb-4">
            {terminado ? 'Lista' : vista.state === 'bloqueada' ? 'Aún no disponible' : 'Configurando'}
          </Badge>
          <h1 className="section-title text-3xl font-light tracking-tight">{vista.areaLabel}</h1>
        </header>

        {/* Pasos 1 y 2: qué es y qué cambia. Se ven SIEMPRE, incluso con el área
            bloqueada — la promesa es justo lo que hay que enseñar con candado. */}
        <Card className="mb-6 space-y-4 p-6">
          {script.intro ? (
            <p className="text-pretty leading-relaxed">{script.intro}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Todavía no hay un guion escrito para esta área en tu giro.
            </p>
          )}
          {script.promise && (
            <p className="flex items-start gap-2.5 border-t border-border/60 pt-4 text-pretty text-sm leading-relaxed text-primary">
              <Icon name="sparkles" className="mt-0.5 h-4 w-4 shrink-0" />
              {script.promise}
            </p>
          )}
        </Card>

        {vista.state === 'bloqueada' ? (
          <Cerrada />
        ) : terminado ? (
          <Resultado vista={vista} aviso={aviso} />
        ) : (
          <Paso3
            vista={vista}
            texto={texto}
            setTexto={setTexto}
            pendiente={pendiente}
            empezado={empezado}
            onEmpezar={() => aplicar(() => empezar(vista.areaSlug))}
            onResponder={() =>
              question && aplicar(() => responder(vista.areaSlug, question.key, texto))
            }
            onTerminar={() => aplicar(() => terminar(vista.areaSlug))}
          />
        )}

        {error && (
          <p role="alert" className="mt-6 text-sm text-[hsl(var(--color-error-fg))]">
            {error}
          </p>
        )}
      </main>
    </AccentScope>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function Cerrada() {
  return (
    <Card className="flex flex-col items-center gap-4 p-8 text-center">
      <Icon name="lock" className="h-6 w-6 text-muted-foreground" />
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Esta área todavía no está abierta. Se abre sola en cuanto cumplas lo que pide — no hay que
        apretar nada.
      </p>
      <Button asChild variant="glass" size="sm">
        <Link href="/mapa">Ver qué falta</Link>
      </Button>
    </Card>
  );
}

function Paso3({
  vista,
  texto,
  setTexto,
  pendiente,
  empezado,
  onEmpezar,
  onResponder,
  onTerminar,
}: {
  vista: OnboardingView;
  texto: string;
  setTexto: (v: string) => void;
  pendiente: boolean;
  empezado: boolean;
  onEmpezar: () => void;
  onResponder: () => void;
  onTerminar: () => void;
}) {
  const { script, question, readyToFinish } = vista;

  if (!empezado) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onEmpezar} disabled={pendiente || !script.questions.length}>
          <Icon name="arrow-right" className="h-4 w-4" />
          {script.questions.length
            ? `Contestar ${script.questions.length} preguntas`
            : 'No hay guion todavía'}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/mapa">Prefiero explorar solo</Link>
        </Button>
      </div>
    );
  }

  if (question) {
    return (
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          {script.questions.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i < question.index ? 'bg-primary' : i === question.index ? 'bg-primary/50' : 'bg-secondary',
              )}
            />
          ))}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {question.index + 1}/{question.total}
          </span>
        </div>

        <label htmlFor="respuesta" className="block text-pretty text-lg font-light leading-snug">
          {question.prompt}
        </label>

        <Textarea
          id="respuesta"
          rows={4}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Con tus palabras. No hay respuesta correcta."
          maxLength={2000}
          disabled={pendiente}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onResponder} disabled={!texto.trim() || pendiente}>
            {question.index + 1 === question.total ? 'Terminar' : 'Siguiente'}
            <Icon name="arrow-right" className="h-4 w-4" />
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/mapa">Sigo después</Link>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-6">
      <p className="text-pretty leading-relaxed">
        Ya está. Con lo que me contaste te preparo{' '}
        <span className="text-primary">{script.result?.label ?? 'tu primer resultado'}</span>.
      </p>
      <Button onClick={onTerminar} disabled={pendiente || !readyToFinish}>
        <Icon name="sparkles" className="h-4 w-4" />
        {pendiente ? 'Preparándolo…' : 'Verlo'}
      </Button>
    </Card>
  );
}

/**
 * Paso 4 — el primer resultado visible.
 *
 * Si el agente no pudo generarlo, se DICE, y el área queda activa igual. Un
 * texto inventado localmente haciéndose pasar por el análisis de su agente sería
 * peor que no tener nada.
 */
function Resultado({ vista, aviso }: { vista: OnboardingView; aviso: string | null }) {
  const r = vista.run?.result;

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-6">
        <header className="flex items-center gap-2.5">
          <Icon name="check" className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {r?.label || vista.script.result?.label || 'Tu primer resultado'}
          </h2>
        </header>

        {r ? (
          <div className="whitespace-pre-wrap text-pretty text-sm leading-relaxed">{r.body}</div>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            El área ya está lista y tus respuestas quedaron guardadas, pero tu agente no pudo
            preparar el resultado{aviso ? `: ${aviso}` : '.'} Puedes volver a intentarlo más tarde.
          </p>
        )}
      </Card>

      {vista.run && vista.run.answers.length > 0 && (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <Icon name="chevron-right" className="h-3 w-3 transition-transform group-open:rotate-90" />
            Lo que me contaste
          </summary>
          <dl className="mt-4 space-y-4 border-l border-border/60 pl-4">
            {vista.script.questions.map((q) => {
              const a = vista.run?.answers.find((x) => x.key === q.key);
              return a ? (
                <div key={q.key}>
                  <dt className="text-xs text-muted-foreground">{q.prompt}</dt>
                  <dd className="mt-1 text-sm leading-relaxed">{a.answer}</dd>
                </div>
              ) : null;
            })}
          </dl>
        </details>
      )}

      <Button asChild variant="glass">
        <Link href="/mapa">Volver al mapa</Link>
      </Button>
    </div>
  );
}
