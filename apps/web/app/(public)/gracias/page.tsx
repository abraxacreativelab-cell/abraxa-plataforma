import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent } from '@abraxa/ui';

export const metadata: Metadata = {
  title: 'Gracias',
  description: 'Tu pago se recibió. En un momento te llega el correo con tu enlace.',
  robots: { index: false },
};

/**
 * A donde Stripe regresa al emprendedor después de pagar. Dueño: H10.
 *
 * ── La honestidad que esta página necesita ─────────────────────────────────
 *
 * Cuando alguien llega aquí, su cuenta probablemente TODAVÍA NO EXISTE. El
 * `success_url` de Stripe se abre en cuanto se aprueba el cargo; el webhook
 * que crea el tenant viaja por otro lado y puede tardar unos segundos.
 *
 * Así que esta página no puede decir "tu cuenta está lista" —sería mentira la
 * mitad de las veces— ni tampoco "entra aquí", porque el enlace no funcionaría
 * todavía. Dice lo único que es cierto siempre: el pago entró y el correo va
 * en camino.
 *
 * Tampoco consulta el estado del alta. Hacerlo obligaría a poner a alguien a
 * mirar una ruleta contra un webhook que no controlamos, y a inventar qué
 * mostrar cuando se acabe el tiempo. El correo es el acuse, y llega aunque él
 * cierre esta pestaña.
 */
export default function Page() {
  return (
    <main id="contenido" className="mx-auto w-full max-w-2xl px-5 py-20 sm:px-6 sm:py-28">
      <p className="eyebrow eyebrow-primary">Pago recibido</p>

      <h1 className="mt-5 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
        Gracias. Ya vamos a preparar tu espacio.
      </h1>

      <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
        En los próximos minutos te llega un correo con el enlace para entrar. Ahí tu agente
        maestro te va a hacer unas preguntas para entender cómo trabajas — es lo único que
        necesitas hacer.
      </p>

      <Card className="glass mt-10">
        <CardContent className="space-y-3 p-6 text-sm leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">¿Y si no llega el correo?</p>
          <p>
            Revisa spam y promociones primero. Si en 15 minutos no aparece, escríbenos a{' '}
            <a
              className="text-foreground underline underline-offset-4"
              href="mailto:hola@abraxa.club"
            >
              hola@abraxa.club
            </a>{' '}
            con el correo que usaste al pagar y lo resolvemos nosotros. Tu pago está registrado:
            no tienes que volver a pagar por ningún motivo.
          </p>
        </CardContent>
      </Card>

      <p className="mt-10 text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Volver al inicio
        </Link>
      </p>
    </main>
  );
}
