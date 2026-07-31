import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Card, CardContent } from '@abraxa/ui';

export const metadata: Metadata = {
  title: 'Tu espacio está listo',
  description: 'Entra y conoce a tu agente maestro.',
  robots: { index: false },
};

/**
 * A donde apunta el correo de bienvenida. Dueño: H10.
 *
 * ── Por qué el correo llega aquí y no directo al Ritual ────────────────────
 *
 * El destino natural sería el login (H18) y de ahí el Ritual de Fundación
 * (H7). Ninguno de los dos existe todavía, y un correo de bienvenida con un
 * enlace roto es peor que no mandarlo: es la primera impresión del producto
 * después de que la persona ya pagó.
 *
 * Esta página es el punto de encuentro. Hoy confirma el alta y dice qué sigue;
 * cuando H18 aterrice, el botón manda a iniciar sesión y de ahí al Ritual.
 * `packages/billing/src/correo.ts` no cambia — apunta aquí desde el principio.
 *
 * `?empresa=<slug>` viene del correo. Se muestra para que la persona reconozca
 * su negocio, y NO se usa para dar acceso a nada: quien decide qué puede ver
 * es la sesión, no un parámetro de la URL.
 */
export default function Page({
  searchParams,
}: {
  searchParams?: { empresa?: string | string[] };
}) {
  const crudo = searchParams?.empresa;
  const slug = sanear(Array.isArray(crudo) ? crudo[0] : crudo);

  return (
    <main id="contenido" className="mx-auto w-full max-w-2xl px-5 py-20 sm:px-6 sm:py-28">
      <p className="eyebrow eyebrow-primary">Tu espacio está listo</p>

      <h1 className="mt-5 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
        {slug ? 'Bienvenido. Ya tienes dónde trabajar.' : 'Bienvenido a ABRAXA.'}
      </h1>

      {slug ? (
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          Tu negocio vive en{' '}
          <span className="font-mono text-foreground">mi.abraxa.club/{slug}</span>. Guárdalo: es tu
          dirección de aquí en adelante.
        </p>
      ) : (
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          Tu espacio ya está creado. Entra para conocer a tu agente maestro.
        </p>
      )}

      <Card className="glass mt-10">
        <CardContent className="space-y-4 p-6">
          <p className="text-sm font-medium text-foreground">Lo que sigue</p>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Tu agente maestro te va a hacer unas preguntas sobre cómo trabajas: qué vendes, cómo
            cobras, qué te preguntan siempre. Con eso arma tu operación. Toma unos minutos y es lo
            único que necesitas hacer para arrancar.
          </p>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/ritual">Conocer a mi agente</Link>
          </Button>
        </CardContent>
      </Card>

      <p className="mt-8 text-sm text-muted-foreground">
        ¿Algo no cuadra? Escríbenos a{' '}
        <a className="text-foreground underline underline-offset-4" href="mailto:hola@abraxa.club">
          hola@abraxa.club
        </a>
        .
      </p>
    </main>
  );
}

/**
 * El slug se PINTA en la página, así que se sanea antes de mostrarlo.
 *
 * React ya escapa el texto, de modo que esto no es la defensa contra XSS: es
 * la defensa contra que alguien mande un enlace con `?empresa=` lleno de
 * texto suyo y use nuestra página para dar un mensaje que parezca nuestro.
 * Sólo pasa lo que podría ser un slug de verdad.
 */
function sanear(v: string | undefined): string | null {
  if (!v) return null;
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(v) ? v : null;
}
