'use client';

import { Icon, cn } from '@abraxa/ui';
import type { VozDelRitual } from '../lib/voz-del-ritual';

/**
 * El interruptor de la voz. Visible, chiquito, y apagado por defecto.
 *
 * Tres decisiones, y las tres se pueden defender:
 *
 *  · **Arranca apagado.** Una página que se pone a hablar sola en una oficina
 *    —o a las once de la noche con el teléfono en la mano— es una página que se
 *    cierra. La voz se ofrece; no se impone.
 *  · **Se recuerda.** Quien la encendió ayer la quiere hoy. Vive en el
 *    navegador, que es donde vive esa preferencia, no en el negocio.
 *  · **Desaparece cuando no hay voz.** Si el despliegue no tiene llave, o si
 *    ElevenLabs contestó 402, el interruptor se retira en silencio. Un botón
 *    que no puede hacer nada es peor que ningún botón — y decirle al invitado
 *    "no pagamos la voz" no es su problema.
 */
export function InterruptorDeVoz({ voz }: { voz: VozDelRitual }) {
  if (voz.estado === 'no-disponible') return null;

  const encendida = voz.estado === 'encendida';

  return (
    <button
      type="button"
      // El clic es lo que desbloquea el audio en iOS, así que esta llamada
      // TIENE que salir del gesto. Ver `useVozDelRitual.alternar`.
      onClick={voz.alternar}
      aria-pressed={encendida}
      aria-label={encendida ? 'Apagar la voz de tu agente' : 'Que tu agente te lea las preguntas'}
      title={encendida ? 'Tu agente te está leyendo' : 'Que tu agente te lea'}
      className={cn(
        'flex min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1.5',
        'text-xs transition-colors',
        encendida
          ? 'bg-[hsl(var(--glow)/0.14)] text-foreground'
          : 'text-[hsl(var(--muted-foreground))] hover:text-foreground',
      )}
    >
      <Icon
        name="megaphone"
        className={cn('h-3.5 w-3.5', encendida && voz.narrando && 'animate-pulse')}
      />
      {encendida ? (voz.narrando ? 'leyendo…' : 'con voz') : 'sin voz'}
    </button>
  );
}
