'use client';

import * as React from 'react';
import { Button, Icon, cn } from '@abraxa/ui';
import type { LecturaDelSitio, PropuestaDelSitio } from '../lib/tipos';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  «Pégame tu página y te ahorro preguntas.»
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es el acelerador más grande del embudo y también el más fácil de arruinar.
 *  Dos reglas lo sostienen:
 *
 *   1. **Es un atajo, no un trámite.** Se ofrece una vez, arriba, chiquito, con
 *      "no tengo" a la vista. Quien no tiene página no puede sentir que le
 *      falta un requisito.
 *   2. **Nada se da por cierto.** Lo que salga de la página se enseña como
 *      propuesta EDITABLE con su «esto lo saqué de tu página, ¿está bien?».
 *      Sólo cuando él confirma se manda —como un turno suyo— al Ritual.
 *
 *  Y nunca hay un error en pantalla: los cuatro caminos que no funcionan (no
 *  contesta, no es página, es una SPA en blanco, es un Instagram) llegan
 *  redactados desde el servidor como una frase del agente.
 */
export function Sitio({
  ocupado,
  onLeer,
  onConfirmar,
  onOmitir,
}: {
  ocupado: boolean;
  onLeer: (url: string) => Promise<LecturaDelSitio | null>;
  /** Manda las propuestas confirmadas como un turno del invitado. */
  onConfirmar: (propuestas: PropuestaDelSitio[]) => void;
  onOmitir: () => void;
}) {
  const [url, setUrl] = React.useState('');
  const [leyendo, setLeyendo] = React.useState(false);
  const [lectura, setLectura] = React.useState<LecturaDelSitio | null>(null);
  const [valores, setValores] = React.useState<Record<string, string>>({});

  const leer = async (): Promise<void> => {
    const limpio = url.trim();
    if (!limpio || leyendo) return;

    setLeyendo(true);
    try {
      const r = await onLeer(limpio);
      if (!r) {
        // Ni siquiera se pudo preguntar. No es momento de explicar la red: se
        // sigue por el camino de siempre, que funciona.
        onOmitir();
        return;
      }
      setLectura(r);
      setValores(Object.fromEntries(r.propuestas.map((p) => [p.clave, p.valor])));
      // Nada que confirmar: la frase del agente ya explica por qué, y quedarse
      // en esta tarjeta sería dejarlo mirando un callejón.
      if (!r.sirvio) setTimeout(onOmitir, 2600);
    } finally {
      setLeyendo(false);
    }
  };

  // ── Ya se leyó: la tarjeta de confirmación ────────────────────────────────
  if (lectura) {
    return (
      <div className="glass flex flex-col gap-4 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <Icon
            name={lectura.sirvio ? 'sparkles' : 'help'}
            className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--glow))]"
          />
          <p className="text-sm leading-relaxed text-foreground/90">{lectura.mensaje}</p>
        </div>

        {lectura.sirvio ? (
          <>
            <div className="flex flex-col gap-3">
              {lectura.propuestas.map((p) => (
                <label key={p.clave} className="flex flex-col gap-1.5">
                  <span className="text-[0.7rem] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
                    {p.etiqueta}
                  </span>
                  {/*
                    Editable, no de sólo lectura. Es la diferencia entre "esto
                    saqué, corrígelo" y "esto decidí por ti": si sólo se pudiera
                    aceptar o rechazar, corregir un detalle costaría tirarlo todo.
                  */}
                  <input
                    value={valores[p.clave] ?? ''}
                    onChange={(e) =>
                      setValores((previos) => ({ ...previos, [p.clave]: e.target.value }))
                    }
                    className={cn(
                      'w-full rounded-lg border border-[hsl(var(--border))] bg-transparent',
                      'px-3 py-2.5 text-[0.9rem] text-foreground outline-none',
                      'focus:border-[hsl(var(--glow)/0.6)]',
                    )}
                  />
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                onClick={() =>
                  onConfirmar(
                    lectura.propuestas
                      .map((p) => ({ ...p, valor: (valores[p.clave] ?? '').trim() }))
                      .filter((p) => p.valor.length > 0),
                  )
                }
                disabled={ocupado}
              >
                <Icon name="check" className="h-4 w-4" />
                Sí, así es
              </Button>
              <Button variant="ghost" size="sm" onClick={onOmitir} disabled={ocupado}>
                Mejor te cuento yo
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button variant="outline" size="sm" onClick={onOmitir}>
              Va, cuéntame tú
              <Icon name="arrow-right" className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── Todavía no: el campo ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        ¿Tienes página o Instagram? Pégalo y te ahorro la mitad de las preguntas.
      </p>
      <div className="glass flex items-center gap-2 rounded-2xl p-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void leer();
            }
          }}
          disabled={leyendo || ocupado}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="mitaqueria.mx  ·  @mitaqueria"
          aria-label="Tu página o tu Instagram"
          className="min-h-[44px] flex-1 bg-transparent px-3 text-[0.95rem] text-foreground outline-none placeholder:text-[hsl(var(--muted-foreground)/0.6)]"
        />
        <Button
          size="sm"
          onClick={() => void leer()}
          disabled={leyendo || ocupado || !url.trim()}
        >
          {leyendo ? 'Leyendo…' : 'Léela'}
        </Button>
      </div>
      <button
        type="button"
        onClick={onOmitir}
        className="self-start text-xs text-[hsl(var(--muted-foreground)/0.8)] underline-offset-4 hover:underline"
      >
        No tengo, o mejor te cuento yo
      </button>
    </div>
  );
}
