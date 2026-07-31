import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { BovedaNoDisponible } from '../_lib/session';
import { FalloDeCarga } from './ui';

/**
 * Qué enseñar cuando la bóveda todavía no se puede leer.
 *
 * No es un error genérico a propósito: durante la ola 1 estas pantallas se van
 * a abrir muchas veces antes de que H2 registre el `TenancyPort`, y decir
 * exactamente qué pieza falta ahorra media hora de depuración a cada quien.
 *
 * Y en producción, este mismo estado es la respuesta honesta a «no tienes
 * acceso»: nunca una pantalla vacía que se lea como «no tienes datos».
 */
export function EstadoBoveda({ error }: { error: unknown }) {
  if (error instanceof BovedaNoDisponible) {
    return (
      <FalloDeCarga titulo="Todavía no puedo mostrarte tu bóveda" detalle={error.motivo}>
        <p className="text-xs text-[hsl(var(--muted-foreground))]/70">
          Falta: <span className="font-mono">{error.quienFalta}</span>
        </p>
      </FalloDeCarga>
    );
  }

  const mensaje = error instanceof Error ? error.message : 'Error desconocido';

  return (
    <FalloDeCarga
      titulo="No pudimos cargar tu bóveda"
      detalle="Es un problema nuestro, no algo que hayas hecho mal. Vuelve a intentarlo en un momento."
    >
      <p className="max-w-lg font-mono text-[11px] leading-snug text-[hsl(var(--muted-foreground))]/60">
        {mensaje}
      </p>
    </FalloDeCarga>
  );
}

/** El estado vacío honesto: no hay nada TODAVÍA, y aquí está el primer paso. */
export function BovedaVacia() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[hsl(var(--border))] px-6 py-16 text-center">
      <KeyRound className="h-6 w-6 text-[hsl(var(--muted-foreground))]/50" />
      <p className="text-sm font-medium">Tu bóveda está vacía</p>
      <p className="max-w-md text-sm text-[hsl(var(--muted-foreground))]">
        Pega cualquier documento donde tengas tus precios —una lista, una cotización, hasta un
        mensaje de WhatsApp— y te propongo los números que encuentre. Tú decides cuáles se quedan.
      </p>
      <Link
        href="/direccion/ingesta"
        className="mt-1 rounded-md border border-transparent bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
      >
        Agregar mi primer documento
      </Link>
    </div>
  );
}
