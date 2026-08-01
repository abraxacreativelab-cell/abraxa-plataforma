'use client';

import * as React from 'react';
import { Button, Icon, cn } from '@abraxa/ui';
import type { Ayuda } from '../lib/tipos';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Contestar con el pulgar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Lo que se pinta aquí lo decide el servidor (`vista.ayuda`), que lo saca de
 *  la MISMA tabla que le describe los botones al modelo. Por eso el agente
 *  nunca pregunta una cosa mientras abajo aparecen botones de otra: no hay dos
 *  listas que se puedan desincronizar, hay una.
 *
 *  Tres decisiones que se ven poco y se sienten mucho:
 *
 *   · **Un toque manda.** No hay que elegir y luego apretar "enviar": tocar es
 *     contestar. Un paso de más en la pregunta número uno se paga con gente que
 *     no llega a la número dos.
 *   · **Salvo cuando se pueden elegir varias** (canales, herramientas). Ahí sí
 *     hay confirmación, porque tocar "WhatsApp" no puede cerrar la pregunta
 *     cuando también usa Instagram.
 *   · **Los ejemplos se tocan.** No son texto gris de adorno: tocar uno lo pone
 *     en el campo para que lo edite. Enseñan qué clase de respuesta sirve y
 *     además quitan el miedo a la hoja en blanco.
 */
export function Ayudas({
  ayuda,
  ocupado,
  onResponder,
  onUsarEjemplo,
}: {
  ayuda: Ayuda | null;
  ocupado: boolean;
  /** Manda la respuesta como si la hubiera escrito. */
  onResponder: (texto: string) => void;
  /** Pone el ejemplo en el campo, sin mandarlo. */
  onUsarEjemplo: (texto: string) => void;
}) {
  const [elegidas, setElegidas] = React.useState<string[]>([]);

  // Cambió la pregunta: lo que llevaba elegido ya no significa nada.
  React.useEffect(() => {
    setElegidas([]);
  }, [ayuda?.clave]);

  if (!ayuda) return null;
  if (ayuda.opciones.length === 0 && ayuda.ejemplos.length === 0) return null;

  const alternar = (valor: string): void => {
    setElegidas((previas) =>
      previas.includes(valor) ? previas.filter((v) => v !== valor) : [...previas, valor],
    );
  };

  return (
    <div className="flex flex-col gap-3 px-1" data-ayuda={ayuda.clave}>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{ayuda.titulo}</p>

      {ayuda.opciones.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {ayuda.opciones.map((op) => {
            const elegida = elegidas.includes(op.valor);
            return (
              <button
                key={op.valor}
                type="button"
                disabled={ocupado}
                aria-pressed={ayuda.multiple ? elegida : undefined}
                onClick={() => (ayuda.multiple ? alternar(op.valor) : onResponder(op.valor))}
                className={cn(
                  'glass rounded-full px-4 py-2 text-sm text-foreground/90 transition-all',
                  // 44px de alto: el mínimo con el que un pulgar acierta a la
                  // primera. Debajo de eso la gente falla y culpa al producto.
                  'min-h-[44px] active:scale-[0.97]',
                  'hover:border-[hsl(var(--glow)/0.5)] hover:text-foreground',
                  elegida && 'border-[hsl(var(--glow)/0.7)] bg-[hsl(var(--glow)/0.12)] text-foreground',
                  ocupado && 'pointer-events-none opacity-50',
                )}
              >
                {ayuda.multiple && elegida ? (
                  <Icon name="check" className="mr-1.5 inline h-3.5 w-3.5" />
                ) : null}
                {op.etiqueta}
              </button>
            );
          })}
        </div>
      ) : null}

      {ayuda.multiple && elegidas.length > 0 ? (
        <div>
          <Button size="sm" disabled={ocupado} onClick={() => onResponder(elegidas.join(', '))}>
            Con {elegidas.length === 1 ? 'ése' : 'ésos'} le seguimos
            <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      {ayuda.ejemplos.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground)/0.75)]">
            así contestan otros
          </p>
          <div className="flex flex-col gap-1.5">
            {ayuda.ejemplos.map((ejemplo) => (
              <button
                key={ejemplo}
                type="button"
                disabled={ocupado}
                onClick={() => onUsarEjemplo(ejemplo)}
                className={cn(
                  'rounded-lg border border-[hsl(var(--border)/0.6)] px-3 py-2 text-left',
                  'text-[0.82rem] leading-snug text-[hsl(var(--muted-foreground))] transition-colors',
                  'hover:border-[hsl(var(--glow)/0.45)] hover:text-foreground/85',
                  ocupado && 'pointer-events-none opacity-50',
                )}
              >
                <span aria-hidden className="mr-1.5 opacity-60">
                  ·
                </span>
                {ejemplo}
              </button>
            ))}
          </div>
          <p className="text-[0.7rem] text-[hsl(var(--muted-foreground)/0.7)]">
            Tócalos para partir de ahí. No hace falta escribir tanto.
          </p>
        </div>
      ) : null}

      {ayuda.opciones.length > 0 && ayuda.abierta ? (
        <p className="text-[0.7rem] text-[hsl(var(--muted-foreground)/0.7)]">
          ¿Ninguno le queda? Escríbelo abajo con tus palabras.
        </p>
      ) : null}
    </div>
  );
}
