import Link from 'next/link';
import { Button, Icon } from '@abraxa/ui';
import type { Impedimento } from './lib/tipos';

/**
 * Cuando el Ritual no puede correr, la pantalla lo dice — en el idioma de quien
 * la está leyendo.
 *
 * ── Lo que esta pantalla enseñaba, y por qué era un defecto de producto ────
 *
 * Hasta el 2026-07-31 pintaba una caja monoespaciada con el diagnóstico crudo:
 * «identidadDeLaSesion() → null · lo cablea H2 · apps/web/app/(onboarding)/
 * ritual/lib/sesion.ts». Y no tenía un solo botón: la pantalla terminaba ahí.
 *
 * Un invitado que abre `/ritual` en su teléfono no sabe qué es H2, no tiene el
 * repo y no puede hacer nada con una ruta de archivo. Lo único que entiende es
 * que el producto está a medio hacer. El diagnóstico no se perdió —se escribe
 * en el log del servidor, que es donde lo busca quien puede arreglarlo— pero
 * dejó de estar en la cara del cliente.
 *
 * Lo que sí tiene ahora es SALIDA. Un callejón sin salida es peor que un error:
 * al menos un error se puede reintentar.
 */
export function Espera({ impedimento }: { impedimento: Impedimento }) {
  const copy = COPY[impedimento.tipo];
  const entrada = impedimento.entrada ?? null;

  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6 py-16 sm:py-24"
    >
      <p className="eyebrow-primary">El Ritual de Fundación</p>
      <h1 className="font-display text-2xl tracking-tight sm:text-3xl">{copy.titulo}</h1>
      <p className="text-[hsl(var(--muted-foreground))]">{copy.cuerpo}</p>

      {impedimento.tipo === 'sesion' && entrada ? (
        <div>
          <Button asChild size="lg">
            <Link href={entrada}>
              Entrar con Google
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </Button>
          <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
            Con la misma cuenta de Google que ya traes en el teléfono. Nada más.
          </p>
        </div>
      ) : null}

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
    titulo: 'Primero, ¿quién eres?',
    cuerpo:
      'Tu agente va a entrevistar a TU negocio, así que necesita saber de quién es. Entra con tu ' +
      'cuenta y arrancamos: son unos 15 minutos y puedes parar cuando quieras.',
  },
  empresa: {
    titulo: 'Ya te reconocimos; falta tu empresa.',
    cuerpo:
      'Entraste bien, pero no pudimos abrirte tu espacio de trabajo. No es algo que hayas hecho ' +
      'mal y no perdiste nada. Vuelve a cargar la página en unos segundos.',
    accion: { texto: 'Volver a intentar', href: '/ritual' },
  },
  puerto: {
    titulo: 'Falta una pieza del sistema.',
    cuerpo:
      'Una parte de la que depende el Ritual todavía no está en su lugar. No es un error de tu ' +
      'parte y no hay nada que reintentar todavía.',
  },
  red: {
    titulo: 'No alcanzo a mi propio servicio.',
    cuerpo:
      'La pantalla está bien; lo que no contesta es el servicio del Ritual. Tu avance, si tenías, ' +
      'sigue guardado.',
    accion: { texto: 'Volver a intentar', href: '/ritual' },
  },
  desconocido: {
    titulo: 'Algo se atravesó.',
    cuerpo: 'No pude arrancar el Ritual. Tu avance, si tenías, sigue guardado.',
    accion: { texto: 'Volver a intentar', href: '/ritual' },
  },
};
