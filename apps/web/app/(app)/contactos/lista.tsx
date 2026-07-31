'use client';

/**
 * La lista de contactos, con filtro en vivo.
 *
 * El filtro es del CLIENTE sobre lo que ya se cargó, no un viaje al servidor
 * por cada tecla. Con los cientos de contactos de un negocio chico eso es
 * instantáneo, y evita el patrón donde escribir "san" dispara tres peticiones
 * y la respuesta de la primera pisa a la de la tercera.
 *
 * La búsqueda del servidor —que sí mira identificadores y pagina— entra por la
 * URL (`?q=`), para poder compartir un enlace a un resultado.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, EmptyState, Icon, Input } from '@abraxa/ui';
import { ETIQUETA_CICLO, etiquetaCanal, haceCuanto, iniciales, varianteCiclo } from './formato';
import type { Contact } from './tipos';

export function Lista({ contactos, ahora }: { contactos: Contact[]; ahora: number }) {
  const [filtro, setFiltro] = useState('');

  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return contactos;
    return contactos.filter((c) => {
      const campos = [
        c.displayName ?? '',
        c.companyName ?? '',
        c.ownerEmail ?? '',
        ...c.tags,
        ...c.identities.map((i) => i.identifier),
      ];
      return campos.some((v) => v.toLowerCase().includes(q));
    });
  }, [contactos, filtro]);

  return (
    <section>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Contactos <span className="tabular text-foreground">{contactos.length}</span>
        </h2>

        <div className="relative w-full sm:w-72">
          <Icon
            name="compass"
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
          />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Nombre, teléfono, correo, etiqueta…"
            aria-label="Filtrar contactos"
            className="pl-9"
          />
        </div>
      </header>

      {contactos.length === 0 ? (
        <EmptyState
          icon="contact"
          title="Aún no tienes contactos"
          description="En cuanto alguien te escriba por un canal conectado, su ficha aparece aquí sola —
            con su historial completo y sin que tengas que capturar nada."
        />
      ) : visibles.length === 0 ? (
        <EmptyState
          icon="compass"
          title={`Nadie coincide con "${filtro}"`}
          description="El filtro mira nombre, empresa, responsable, etiquetas y todas las direcciones de canal."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {visibles.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contactos/${c.id}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-secondary/40"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border font-mono text-[11px] text-muted-foreground">
                  {iniciales(c.displayName)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm text-foreground">
                      {c.displayName ?? 'Sin nombre'}
                    </span>
                    {c.placements[0] && (
                      <Badge variant="outline">{c.placements[0].stageName}</Badge>
                    )}
                  </span>

                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground/70">
                    {c.companyName && <span className="truncate">{c.companyName}</span>}
                    {c.identities.slice(0, 2).map((i) => (
                      <span key={i.id} className="truncate">
                        {etiquetaCanal(i.channel)} {i.identifier}
                      </span>
                    ))}
                    {c.identities.length > 2 && <span>+{c.identities.length - 2}</span>}
                  </span>
                </span>

                <span className="hidden shrink-0 sm:block">
                  <Badge variant={varianteCiclo(c.lifecycle)}>{ETIQUETA_CICLO[c.lifecycle]}</Badge>
                </span>

                <span className="tabular hidden w-24 shrink-0 text-right text-xs text-muted-foreground/60 md:block">
                  {haceCuanto(c.lastActivityAt, ahora)}
                </span>

                <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-muted-foreground/40" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
