import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Icon, LoadError } from '@abraxa/ui';
import { cargarContacto, cargarLinea } from '../datos';
import { SinCablear } from '../estados';
import {
  ETIQUETA_CICLO,
  dinero,
  etiquetaCanal,
  haceCuanto,
  iconoCanal,
  iconoEvento,
  iniciales,
  varianteCiclo,
} from '../formato';

export const metadata: Metadata = { title: 'Contacto · ABRAXA Plataforma' };

/**
 * La ficha 360 de un contacto.
 *
 * Es la pantalla que justifica todo el carril: el emprendedor abre esto a las
 * nueve de la mañana y en dos segundos sabe quién le escribió, qué le contestó
 * su agente mientras dormía, en qué etapa quedó y quién lo tiene. Sin la línea
 * de tiempo de `app.contact_events`, esa respuesta habría que armarla juntando
 * la bandeja de H6, el embudo y las corridas de H8 — tres consultas que nadie
 * escribe dos veces igual.
 */
export default async function Page({ params }: { params: { id: string } }) {
  const [contacto, linea] = await Promise.all([
    cargarContacto(params.id),
    cargarLinea(params.id),
  ]);
  const ahora = Date.now();

  if (contacto.estado === 'sin-cablear') {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <Volver />
        <SinCablear motivo={contacto.motivo} />
      </main>
    );
  }

  if (contacto.estado === 'error') {
    if (contacto.falla.status === 404) notFound();
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <Volver />
        <LoadError failure={contacto.falla} />
      </main>
    );
  }

  const c = contacto.datos;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Volver />

      {/* ── Encabezado ─────────────────────────────────────────────────── */}
      <header className="mb-8 flex flex-wrap items-start gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-border font-mono text-sm text-muted-foreground">
          {iniciales(c.displayName)}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {c.displayName ?? 'Sin nombre'}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {c.companyName && <span>{c.companyName}</span>}
            {c.ownerEmail ? (
              <span className="flex items-center gap-1">
                <Icon name="users" className="h-3.5 w-3.5" />
                {c.ownerEmail}
              </span>
            ) : (
              <span className="text-muted-foreground/60">sin responsable</span>
            )}
            <span className="text-muted-foreground/60">
              alta {haceCuanto(c.createdAt, ahora)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant={varianteCiclo(c.lifecycle)}>{ETIQUETA_CICLO[c.lifecycle]}</Badge>
          {c.tags.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ── Línea de tiempo ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Línea de tiempo
          </h2>

          {linea.estado === 'error' && <LoadError failure={linea.falla} />}
          {linea.estado === 'sin-cablear' && <SinCablear motivo={linea.motivo} />}
          {linea.estado === 'datos' &&
            (linea.datos.length === 0 ? (
              <EmptyState
                icon="file"
                title="Todavía no pasa nada aquí"
                description="Cada mensaje, cambio de etapa y etiqueta va a caer en esta lista, con quién lo hizo — una persona o el agente."
              />
            ) : (
              <ol className="relative space-y-4 border-l border-border pl-6">
                {linea.datos.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[1.9rem] grid h-6 w-6 place-items-center rounded-full border border-border bg-background">
                      <Icon name={iconoEvento(e.type)} className="h-3 w-3 text-muted-foreground" />
                    </span>
                    <p className="text-sm text-foreground">{e.summary}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground/60">
                      {haceCuanto(e.occurredAt, ahora)}
                      {e.actor && e.actor !== 'system' && ` · ${e.actor}`}
                      {e.actor === 'ai' && ' · tu agente'}
                    </p>
                  </li>
                ))}
              </ol>
            ))}
        </section>

        {/* ── Lateral ──────────────────────────────────────────────────── */}
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Cómo lo alcanzas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {c.identities.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">
                  Sin direcciones de canal todavía.
                </p>
              ) : (
                c.identities.map((i) => (
                  <div key={i.id} className="flex items-start gap-2">
                    <Icon
                      name={iconoCanal(i.channel)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{i.identifier}</p>
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
                        {etiquetaCanal(i.channel)}
                        {i.isPrimary && ' · principal'}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {c.placements.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Dónde va
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.placements.map((p) => (
                  <div key={p.pipelineId}>
                    <p className="text-sm text-foreground">{p.stageName}</p>
                    <p className="text-xs text-muted-foreground/60">
                      {p.pipelineName} · desde {haceCuanto(p.enteredAt, ahora)}
                      {p.amount !== null && ` · ${dinero(p.amount, p.currency)}`}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}

function Volver() {
  return (
    <Link
      href="/contactos"
      className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon name="chevron-right" className="h-3.5 w-3.5 rotate-180" />
      Contactos
    </Link>
  );
}
