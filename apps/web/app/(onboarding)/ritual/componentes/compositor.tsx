'use client';

import * as React from 'react';
import { Button, Icon, cn } from '@abraxa/ui';

/**
 * Donde escribe el emprendedor.
 *
 * Dos modos, y la diferencia entre ellos es la mitad del §8 del handoff:
 *
 *  · **bautizo** — «el bautizo del agente como un momento, no como un campo de
 *    texto». Una sola pregunta a pantalla completa, tipografía grande, sin nada
 *    más alrededor. Es la primera decisión que toma sobre su empresa aquí
 *    adentro y tiene que sentirse así.
 *  · **normal** — un compositor de chat, con "guardar y seguir después" SIEMPRE
 *    a la vista. Esa promesa se cumple estando visible, no en la letra chica.
 *
 * ── Lo que escribió no se pierde si el turno falla (auditoría PR #8) ───────
 *
 * `ritual.tsx` promete, en su encabezado, que «si el turno falla, se retira [la
 * burbuja] y el texto se le devuelve». La burbuja sí se retiraba; el texto no
 * volvía a ninguna parte. Se limpiaba el campo ANTES de llamar a `onEnviar` y
 * nadie lo restauraba, así que un error de red a media entrevista se llevaba el
 * párrafo que la persona acababa de escribir — y la pantalla, encima, le decía
 * "tu avance está guardado".
 *
 * Se vacía optimista (esperar seis segundos a ver tu campo limpio se siente
 * roto) y se devuelve si `onEnviar` no pudo. Y se devuelve **sólo si el campo
 * sigue vacío**: si mientras tanto empezó a escribir otra cosa, pisarle lo
 * nuevo con lo viejo sería el mismo error al revés.
 */
export function Compositor({
  bautizo,
  ocupado,
  pausada,
  terminado = false,
  onEnviar,
  onPausar,
}: {
  bautizo: boolean;
  ocupado: boolean;
  pausada: boolean;
  /**
   * El Ritual ya cerró y esto es la plática de todos los días.
   *
   * Cambia dos cosas y ninguna es cosmética: el marcador de posición deja de
   * hablar de una entrevista que ya terminó, y desaparece "guardar y seguir
   * después" — que después del cierre no significa nada, porque no hay nada
   * pendiente que retomar.
   */
  terminado?: boolean;
  /** Resuelve `false` si el turno no pudo mandarse: el texto se restaura. */
  onEnviar: (texto: string) => Promise<boolean> | boolean;
  onPausar: () => void;
}) {
  const [texto, setTexto] = React.useState('');
  const campo = React.useRef<HTMLTextAreaElement>(null);
  const campoBautizo = React.useRef<HTMLInputElement>(null);

  const enviar = (): void => {
    const limpio = texto.trim();
    if (!limpio || ocupado) return;
    setTexto('');

    void Promise.resolve(onEnviar(limpio)).then((llego) => {
      if (llego !== false) return;
      setTexto((actual) => (actual.trim() ? actual : limpio));
      // Devolverle el texto sin devolverle el cursor lo deja buscando dónde
      // estaba. El foco es parte de la restauración, no un adorno.
      (campo.current ?? campoBautizo.current)?.focus();
    });
  };

  // Enter manda, Shift+Enter salta de línea. Es lo que la gente espera de un
  // chat, y esperar otra cosa cuesta un mensaje mandado a medias.
  const teclas = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };

  React.useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [texto]);

  if (bautizo) {
    return (
      <div className="flex flex-col items-center gap-6 py-4">
        <p className="text-center text-sm uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
          Ponle nombre
        </p>
        <div className="flex w-full max-w-md items-center gap-3 border-b border-[hsl(var(--glow)/0.45)] pb-3">
          <input
            ref={campoBautizo}
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                enviar();
              }
            }}
            disabled={ocupado}
            maxLength={40}
            placeholder="¿cómo se va a llamar?"
            aria-label="El nombre de tu agente"
            className="w-full bg-transparent text-center text-3xl font-medium tracking-tight text-foreground outline-none placeholder:text-[hsl(var(--muted-foreground)/0.5)] disabled:opacity-50"
          />
        </div>
        <Button onClick={enviar} disabled={ocupado || !texto.trim()} size="lg">
          Así se va a llamar
          <Icon name="arrow-right" className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          'glass flex items-end gap-2 rounded-2xl p-2 transition-colors',
          ocupado && 'opacity-60',
        )}
      >
        <textarea
          ref={campo}
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={teclas}
          disabled={ocupado}
          placeholder={
            terminado ? 'Pregúntale lo que quieras de tu negocio…' : 'Escríbele a tu agente…'
          }
          aria-label={terminado ? 'Tu pregunta' : 'Tu respuesta'}
          className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[0.95rem] leading-relaxed text-foreground outline-none placeholder:text-[hsl(var(--muted-foreground)/0.7)]"
        />
        <Button
          size="icon"
          onClick={enviar}
          disabled={ocupado || !texto.trim()}
          aria-label="Mandar"
        >
          <Icon name="arrow-right" className="h-4 w-4" />
        </Button>
      </div>

      {/*
        En un teléfono estos dos elementos no caben en una línea: el texto se
        aprieta a dos o tres renglones y el botón se encoge hasta ser difícil de
        picar. Se apilan hasta `sm` y se ponen lado a lado a partir de ahí.
      */}
      <div className="flex flex-col items-start gap-2 px-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {terminado
            ? 'Tu agente ya conoce tu negocio. Pregúntale lo que sea.'
            : pausada
              ? 'Guardado. Escribe cuando quieras y seguimos donde te quedaste.'
              : 'Todo se guarda solo. Puedes irte cuando quieras.'}
        </p>
        {!terminado ? (
          <Button variant="ghost" size="sm" onClick={onPausar} disabled={ocupado || pausada}>
            <Icon name="check" className="h-3.5 w-3.5" />
            Guardar y seguir después
          </Button>
        ) : null}
      </div>
    </div>
  );
}
