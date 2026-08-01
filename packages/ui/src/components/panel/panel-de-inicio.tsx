'use client';

import * as React from 'react';
import Link from 'next/link';
import type { AreaSummary } from '@abraxa/db/ports';
import { Icon } from '../primitives/icon';
import { Badge } from '../primitives/badge';
import { cn } from '../../lib/cn';
import { isNavigable } from '../nav/resolve-areas';
import { AnilloDeProgreso } from './anillo-de-progreso';
import { TarjetaDeArea } from './tarjeta-de-area';
import {
  type HitoDelRitual,
  type PasoDelRitual,
  type RitualEnPanel,
  hitosDelRitual,
  llamadaDelPanel,
  nombreDelAgente,
} from './lectura-del-ritual';

export interface PanelDeInicioProps {
  /** El nombre de la empresa. Es el primer dato real que ve el invitado. */
  nombreDelNegocio: string | null;
  /** Con qué cuenta entró. En un evento la mitad tiene dos sesiones de Google. */
  correo?: string | null;
  /** Clave del plan (`free`, `pro`…). Se muestra tal cual si viene. */
  plan?: string | null;
  ritual: RitualEnPanel | null;
  /** Las 7 fases con su promesa, de `GET /onboarding/_status`. */
  pasos?: readonly PasoDelRitual[];
  /** `true` si la foto del Ritual no se pudo leer. Se dice, no se disimula. */
  ritualNoDisponible?: boolean;
  areas: AreaSummary[] | null;
  requisitos?: Record<string, string>;
  brand?: string | null;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El panel — la primera pantalla del producto
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  «Tenemos que lograr que la parte de preguntas y respuestas sea mucho más
 *   rápida para no perder al cliente, y poder entregarle algo impresionante ya
 *   en la plataforma.»
 *
 *  Eso invierte el embudo: hoy el Ritual pregunta siete veces y entrega valor al
 *  final. Esta pantalla entrega valor a la segunda pregunta, y usa ese valor
 *  como motivo para seguir.
 *
 *  ── Tres datos reales bien puestos, no doce tarjetas vacías ────────────────
 *
 *  Todo lo que se pinta aquí existe de verdad en la base hoy:
 *
 *    · el nombre de su empresa            `app.tenants.name`
 *    · el nombre que le puso a su agente  `onboarding_sessions.state.agente`
 *    · lo que el agente ya le sacó        `memoria` → las viñetas de H7
 *    · en qué fase va, de siete           `vista.faseIndice` / `progreso`
 *
 *  Si algo de eso no está, NO se rellena con un cero ni con un guion largo: se
 *  cambia el bloque por uno que invite a conseguirlo. Un panel que enseña ceros
 *  el primer día enseña que el producto está vacío.
 *
 *  ── Y lo bloqueado es el gancho ────────────────────────────────────────────
 *
 *  El mosaico de áreas va DEBAJO del Ritual a propósito: primero ve lo que ya
 *  tiene, luego ve las cuatro puertas y qué falta para abrir cada una. Ese orden
 *  es el que convierte "me faltan preguntas" en "quiero abrir Dirección".
 */
export function PanelDeInicio({
  nombreDelNegocio,
  correo,
  plan,
  ritual,
  pasos = [],
  ritualNoDisponible = false,
  areas,
  requisitos = {},
  brand,
}: PanelDeInicioProps) {
  const hitos = React.useMemo(() => hitosDelRitual(pasos, ritual), [pasos, ritual]);
  const siguiente = hitos.find((h) => h.estado === 'actual') ?? null;
  const llamada = llamadaDelPanel(ritual, siguiente);
  const agente = nombreDelAgente(ritual);
  const sabe = ritual?.loQueYaSabe ?? [];

  const abiertas = areas?.filter(isNavigable).length ?? 0;
  const total = areas?.length ?? 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      {/* ── Quién eres ──────────────────────────────────────────────────── */}
      <header className="mb-8 sm:mb-12">
        <p className="eyebrow">Tu panel</p>

        <h1 className="mt-2 text-balance text-3xl font-light tracking-tight sm:text-4xl">
          {nombreDelNegocio ?? 'Tu negocio'}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          {ritual?.agente ? (
            <span className="flex items-center gap-1.5">
              <Icon name="bot" className="h-3.5 w-3.5 text-primary" />
              <span className="text-foreground/90">{ritual.agente}</span> es tu agente
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Icon name="bot" className="h-3.5 w-3.5" />
              Todavía no le pones nombre a tu agente
            </span>
          )}

          {plan && (
            <Badge variant="secondary" className="uppercase">
              Plan {plan}
            </Badge>
          )}
        </div>

        {correo && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground/60">Entraste como {correo}</p>
        )}
      </header>

      {/* ── El Ritual: lo que ya tienes y lo que sigue ───────────────────── */}
      <section
        aria-labelledby="titulo-ritual"
        className="glass light-leak light-leak-accent hud-frame rounded-2xl p-5 sm:p-8"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
          <AnilloDeProgreso
            valor={ritual?.progreso ?? 0}
            etiqueta={
              ritual
                ? `Llevas ${ritual.faseIndice} de ${ritual.fasesTotales} fases del Ritual`
                : 'Todavía no empiezas tu Ritual'
            }
            className="mx-auto sm:mx-0"
          >
            <span className="block">
              <span className="text-2xl">{ritual?.faseIndice ?? 0}</span>
              <span className="text-sm text-muted-foreground">/{ritual?.fasesTotales ?? 7}</span>
            </span>
          </AnilloDeProgreso>

          <div className="min-w-0 flex-1">
            <h2 id="titulo-ritual" className="text-xl font-light tracking-tight">
              {llamada.titulo}
            </h2>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
              {llamada.texto}
            </p>

            <Link
              href={llamada.href}
              className="glass-btn mt-5 inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {llamada.boton}
              <Icon name="arrow-right" className="h-3.5 w-3.5 text-primary" />
            </Link>

            {ritualNoDisponible && (
              <p className="mt-4 text-[12px] leading-snug text-muted-foreground/70">
                No pudimos leer en qué punto va tu Ritual justo ahora. Tu conversación no se perdió:
                entra y sigue donde la dejaste.
              </p>
            )}
          </div>
        </div>

        {/* Lo que el agente YA sabe. Es el bloque que hace que valga la pena
            haber contestado — y son frases suyas, no etiquetas nuestras. */}
        {sabe.length > 0 && (
          <div className="mt-7 border-t border-border/50 pt-6">
            <p className="eyebrow">Lo que {agente} ya sabe de tu negocio</p>
            <ul className="mt-3 space-y-2">
              {sabe.map((frase) => (
                <li key={frase} className="flex gap-2.5 text-sm leading-relaxed">
                  <Icon name="check" className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="text-pretty text-foreground/90">{frase}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Las 7 fases ──────────────────────────────────────────────────── */}
      {hitos.length > 0 && (
        <section aria-labelledby="titulo-fases" className="mt-10">
          <h2 id="titulo-fases" className="eyebrow">
            Las {hitos.length} conversaciones de tu Ritual
          </h2>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {hitos.map((h, i) => (
              <Fase key={h.fase} hito={h} numero={i + 1} />
            ))}
          </ol>
        </section>
      )}

      {/* ── Las áreas: el gancho ─────────────────────────────────────────── */}
      <section aria-labelledby="titulo-areas" className="mt-10 sm:mt-14">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="titulo-areas" className="section-title">
            Las áreas de tu negocio
          </h2>
          {total > 0 && (
            <p className="tabular text-xs text-muted-foreground">
              {abiertas} de {total} abiertas
            </p>
          )}
        </div>

        {areas && areas.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {areas.map((a) => (
              <TarjetaDeArea
                key={a.slug}
                area={a}
                requisito={requisitos[a.slug]}
                brand={brand}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Cuando termines de contarle a {agente} cómo funciona tu negocio, aquí aparece tu mapa de
            áreas.
          </div>
        )}
      </section>
    </main>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function Fase({ hito, numero }: { hito: HitoDelRitual; numero: number }) {
  const cerrada = hito.estado === 'cerrada';
  const actual = hito.estado === 'actual';

  return (
    <li
      className={cn(
        'rounded-lg border p-3 transition-colors',
        actual
          ? 'border-primary/40 bg-primary/5'
          : cerrada
            ? 'border-border/60'
            : 'border-border/40 opacity-70',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'tabular grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px]',
            cerrada
              ? 'bg-primary/15 text-primary'
              : actual
                ? 'border border-primary/50 text-primary'
                : 'border border-border text-muted-foreground/70',
          )}
        >
          {cerrada ? <Icon name="check" className="h-3 w-3" /> : numero}
        </span>
        <p
          className={cn(
            'truncate text-[13px] font-medium',
            actual ? 'text-primary' : cerrada ? 'text-foreground/90' : 'text-muted-foreground',
          )}
        >
          {hito.titulo}
        </p>
        {actual && <span className="status-dot-live ml-auto shrink-0" aria-hidden />}
      </div>
      <p className="mt-1.5 text-pretty text-[11px] leading-snug text-muted-foreground/70">
        {hito.promesa}
      </p>
    </li>
  );
}
