import { Icon } from '@abraxa/ui';

/**
 * «Esto es lo que ya sé de ti», antes de que el agente conteste.
 *
 * Se pinta con datos que ya venían en la carga de la página —cero llamadas al
 * modelo—, y por eso aparece de inmediato. Quien vuelve tres días después no
 * debería tener que esperar a un proveedor para saber que su trabajo sigue ahí:
 * el §6 del handoff dice que sentirse recordado es la mitad del valor, y medio
 * valor que llega en ocho segundos ya no es el mismo.
 */
export function Regreso({ memoria, ausencia }: { memoria: string; ausencia: string | null }) {
  if (!memoria) return null;

  const [saludo, ...resto] = memoria.split('\n\n');

  return (
    <aside className="glass flex flex-col gap-3 rounded-xl border-[hsl(var(--glow)/0.3)] p-5">
      <p className="flex items-center gap-2 eyebrow-primary">
        <Icon name="refresh" className="h-3.5 w-3.5" />
        {ausencia ? `Retomamos ${ausencia}` : 'Retomamos'}
      </p>
      <p className="text-sm text-foreground/90">{saludo}</p>
      {resto.map((bloque, i) => (
        <p
          key={i}
          className="whitespace-pre-line text-sm leading-relaxed text-[hsl(var(--muted-foreground))]"
        >
          {bloque}
        </p>
      ))}
    </aside>
  );
}
