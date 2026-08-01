import Link from 'next/link';
import { Button, Icon } from '@abraxa/ui';
import type { Impedimento } from './lib/tipos';

/**
 * Cuando el Ritual no puede correr, la pantalla lo dice.
 *
 * No hay pantalla falsa ni datos de mentiras: si no hay sesión verificada, el
 * Ritual no sabe de qué empresa es quien entró, y fingir que sí es exactamente
 * cómo se cuela un agujero de aislamiento. Se dice qué falta y quién lo entrega
 * —el mismo criterio con el que H5 dejó su shell y con el que H3 dejó sus
 * rutas— para que quien lo tope no pierda una tarde averiguándolo.
 */
export function Espera({ impedimento }: { impedimento: Impedimento }) {
  const copy = COPY[impedimento.tipo];

  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-24"
    >
      <p className="eyebrow-primary">El Ritual de Fundación</p>
      <h1 className="font-display text-3xl tracking-tight">{copy.titulo}</h1>
      <p className="text-[hsl(var(--muted-foreground))]">{copy.cuerpo}</p>

      <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] p-4 font-mono text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        {impedimento.mensaje}
      </p>

      {copy.accion ? (
        <div>
          <Button asChild variant="outline">
            <Link href={copy.accion.href}>
              {copy.accion.texto}
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}
    </main>
  );
}

const COPY: Record<
  Impedimento['tipo'],
  { titulo: string; cuerpo: string; accion?: { texto: string; href: string } }
> = {
  sesion: {
    titulo: 'Falta saber quién eres.',
    cuerpo:
      'El Ritual entrevista a una empresa concreta, así que necesita una sesión verificada para saber cuál. El inicio de sesión lo entrega H2 (packages/tenancy); en cuanto aterrice, esta pantalla arranca sola.',
  },
  puerto: {
    titulo: 'Falta una pieza del sistema.',
    cuerpo:
      'Un carril del que depende el Ritual todavía no está en su lugar. No es un error de tu parte y no hay nada que reintentar todavía.',
  },
  red: {
    titulo: 'No alcanzo a mi propia API.',
    cuerpo:
      'La pantalla está bien; lo que no contesta es el servicio del Ritual. Si esto pasa en desarrollo, revisa que `apps/api` esté corriendo y que `API_BASE_URL` apunte a donde debe.',
  },
  desconocido: {
    titulo: 'Algo se atravesó.',
    cuerpo: 'No pude arrancar el Ritual. Tu avance, si tenías, sigue guardado.',
  },
};
