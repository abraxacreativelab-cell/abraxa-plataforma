'use client';

import * as React from 'react';
import { Button, Icon, cn } from '@abraxa/ui';
import { Ayudas } from './ayudas';
import type { Ayuda } from '../lib/tipos';
import type { VozDelRitual } from '../lib/voz-del-ritual';

/**
 * Donde escribe —o toca, o dicta— el emprendedor.
 *
 * Dos modos, y la diferencia entre ellos es la mitad del §8 del handoff:
 *
 *  · **bautizo** — «el bautizo del agente como un momento, no como un campo de
 *    texto». Una sola pregunta a pantalla completa, tipografía grande, sin nada
 *    más alrededor. Es la primera decisión que toma sobre su empresa aquí
 *    adentro y tiene que sentirse así. Desde el 2026-08-01 con cinco nombres a
 *    un toque: ponerle nombre a algo es la parte bonita y también la que
 *    congela a la gente.
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
 *
 * ── Tres formas de contestar, una sola salida ──────────────────────────────
 *
 * Tocar un botón, dictar y escribir terminan todos en `onEnviar`. No hay una
 * ruta de escritura por cada medio: el motor recibe siempre un turno del
 * invitado, así que las condiciones de cierre de `cierre.ts` valen igual haya
 * hablado, tecleado o tocado.
 */
export function Compositor({
  bautizo,
  ocupado,
  pausada,
  terminado = false,
  ayuda,
  voz,
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
   * hablar de una entrevista que ya terminó, y "guardar y seguir después" se
   * convierte en la salida al panel — que después del cierre es a donde de
   * verdad quiere ir.
   */
  terminado?: boolean;
  /** Los botones y ejemplos del dato que se está pidiendo. Los decide el guion. */
  ayuda: Ayuda | null;
  voz: VozDelRitual;
  /** Resuelve `false` si el turno no pudo mandarse: el texto se restaura. */
  onEnviar: (texto: string) => Promise<boolean> | boolean;
  onPausar: () => void;
}) {
  const [texto, setTexto] = React.useState('');
  const campo = React.useRef<HTMLTextAreaElement>(null);
  const campoBautizo = React.useRef<HTMLInputElement>(null);

  const mandar = (crudo: string): void => {
    const limpio = crudo.trim();
    if (!limpio || ocupado) return;

    // Una voz que sigue leyendo mientras él ya contestó es una voz que estorba.
    voz.callar();
    setTexto('');

    void Promise.resolve(onEnviar(limpio)).then((llego) => {
      if (llego !== false) return;
      setTexto((actual) => (actual.trim() ? actual : limpio));
      // Devolverle el texto sin devolverle el cursor lo deja buscando dónde
      // estaba. El foco es parte de la restauración, no un adorno.
      (campo.current ?? campoBautizo.current)?.focus();
    });
  };

  const enviar = (): void => mandar(texto);

  /**
   * Escribir CALLA al agente. Es la regla 2 de la voz y no admite matices.
   *
   * Se engancha a `onChange` y no a `onFocus`: enfocar el campo puede ser un
   * roce, teclear no. Y `callar()` es idempotente y barato, así que llamarlo en
   * cada tecla no cuesta nada.
   */
  const escribir = (valor: string): void => {
    if (voz.narrando) voz.callar();
    setTexto(valor);
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

  // ── El micrófono ──────────────────────────────────────────────────────────
  //
  // Se graba en el navegador y se transcribe en el servidor porque en el Safari
  // del iPhone no existe `SpeechRecognition`, y con un iPhone llega la mitad de
  // los invitados. Lo transcrito NO se manda solo: aterriza en el campo para
  // que lo lea y lo corrija. Mandarlo a ciegas convierte cada gallo del
  // reconocedor en un mensaje que él no dijo.
  const alternarDictado = async (): Promise<void> => {
    if (voz.grabando) {
      const dicho = await voz.terminarDictado();
      if (dicho) {
        setTexto((actual) => (actual.trim() ? `${actual.trim()} ${dicho}` : dicho));
        campo.current?.focus();
      }
      return;
    }
    await voz.dictar();
  };

  const botonDeMicrofono = voz.puedeDictar ? (
    <Button
      size="icon"
      variant={voz.grabando ? 'default' : 'ghost'}
      onClick={() => void alternarDictado()}
      disabled={ocupado}
      aria-label={voz.grabando ? 'Terminar de dictar' : 'Dictar tu respuesta'}
      aria-pressed={voz.grabando}
      className={cn(voz.grabando && 'animate-pulse')}
    >
      {/*
        `headset` y no un micrófono porque el design system no trae uno, y
        inventarse un SVG suelto aquí sería la primera grieta de un sistema que
        catorce carriles comparten. Es el icono de "hablar", que es lo que hace.
      */}
      <Icon name={voz.grabando ? 'check' : 'headset'} className="h-4 w-4" />
    </Button>
  ) : null;

  // ── El bautizo ────────────────────────────────────────────────────────────
  if (bautizo) {
    return (
      <div className="flex flex-col items-center gap-5 py-4">
        <p className="text-center text-sm uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
          Ponle nombre
        </p>
        <div className="flex w-full max-w-md items-center gap-3 border-b border-[hsl(var(--glow)/0.45)] pb-3">
          <input
            ref={campoBautizo}
            autoFocus
            value={texto}
            onChange={(e) => escribir(e.target.value)}
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

        {ayuda && ayuda.opciones.length > 0 ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{ayuda.titulo}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {ayuda.opciones.map((op) => (
                <button
                  key={op.valor}
                  type="button"
                  disabled={ocupado}
                  onClick={() => mandar(op.valor)}
                  className={cn(
                    'glass min-h-[44px] rounded-full px-5 py-2 text-sm text-foreground/90',
                    'transition-all hover:border-[hsl(var(--glow)/0.5)] hover:text-foreground',
                    'active:scale-[0.97]',
                    ocupado && 'pointer-events-none opacity-50',
                  )}
                >
                  {op.etiqueta}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <Button onClick={enviar} disabled={ocupado || !texto.trim()} size="lg">
          Así se va a llamar
          <Icon name="arrow-right" className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // ── El compositor de siempre ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      {!terminado ? (
        <Ayudas
          ayuda={ayuda}
          ocupado={ocupado}
          onResponder={mandar}
          onUsarEjemplo={(ejemplo) => {
            voz.callar();
            setTexto(ejemplo);
            campo.current?.focus();
          }}
        />
      ) : null}

      {voz.avisoDelMicrofono ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2"
        >
          <Icon name="help" className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
          <p className="flex-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
            {voz.avisoDelMicrofono}
          </p>
          <button
            type="button"
            onClick={voz.limpiarAviso}
            aria-label="Cerrar el aviso"
            className="text-[hsl(var(--muted-foreground))] hover:text-foreground"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          'glass flex items-end gap-2 rounded-2xl p-2 transition-colors',
          ocupado && 'opacity-60',
          voz.grabando && 'border-[hsl(var(--glow)/0.7)]',
        )}
      >
        <textarea
          ref={campo}
          rows={1}
          value={texto}
          onChange={(e) => escribir(e.target.value)}
          onKeyDown={teclas}
          disabled={ocupado}
          placeholder={
            voz.grabando
              ? `Te escucho… ${voz.segundos}s`
              : terminado
                ? 'Pregúntale lo que quieras de tu negocio…'
                : 'Escríbele a tu agente…'
          }
          aria-label={terminado ? 'Tu pregunta' : 'Tu respuesta'}
          className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[0.95rem] leading-relaxed text-foreground outline-none placeholder:text-[hsl(var(--muted-foreground)/0.7)]"
        />
        {botonDeMicrofono}
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
        En un teléfono estos elementos no caben en una línea: el texto se
        aprieta a dos o tres renglones y el botón se encoge hasta ser difícil de
        picar. Se apilan hasta `sm` y se ponen lado a lado a partir de ahí.
      */}
      <div className="flex flex-col items-start gap-2 px-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {voz.grabando
            ? 'Habla normal. Toca la palomita cuando termines.'
            : terminado
              ? 'Tu agente ya conoce tu negocio. Pregúntale lo que sea.'
              : pausada
                ? 'Guardado. Escribe cuando quieras y seguimos donde te quedaste.'
                : 'Todo se guarda solo. Puedes irte cuando quieras.'}
        </p>
        <Button variant="ghost" size="sm" onClick={onPausar} disabled={ocupado}>
          <Icon name={terminado ? 'arrow-right' : 'check'} className="h-3.5 w-3.5" />
          {terminado ? 'Ir a mi panel' : 'Guardar y ver mi panel'}
        </Button>
      </div>
    </div>
  );
}
