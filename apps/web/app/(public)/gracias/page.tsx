import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent } from '@abraxa/ui';
import { RUTA_DE_ENTRADA } from '../../../../../packages/auth/src/identidad';

export const metadata: Metadata = {
  title: 'Gracias',
  description: 'Tu pago se recibió. Entra con tu cuenta de Google.',
  robots: { index: false },
};

/**
 * A donde Stripe regresa al emprendedor después de pagar. Dueño: H10.
 *
 * ── Por qué esta página ya no promete un correo ────────────────────────────
 *
 * Porque el correo NO SALE. `enviarBienvenida()` (packages/billing/src/correo.ts)
 * necesita `RESEND_API_KEY`, y esa variable no existe en el `.env` de
 * producción: sin ella la función escribe el correo en la consola del servidor
 * y devuelve `{ enviado: false, via: 'doble' }`. O sea que la versión anterior
 * de esta página mandaba a alguien que ACABA DE PAGAR a vigilar una bandeja
 * —y su carpeta de spam— durante quince minutos, esperando algo que nunca
 * iba a llegar. Prometer un correo que no sale es peor que no prometer nada:
 * es la primera impresión del producto justo después del cobro.
 *
 * ── Por qué "entra con Google" sí es verdad siempre ────────────────────────
 *
 * El `success_url` de Stripe se abre en cuanto se aprueba el cargo, y el
 * webhook que crea el tenant viaja por otro lado: cuando alguien lee esto, su
 * empresa puede llevar dos segundos existiendo o no existir todavía. Antes eso
 * obligaba a no decir "entra aquí", porque el enlace podía no funcionar.
 *
 * Ya no. El alta por Google es idempotente y se cura sola: `empresaDe()`
 * (packages/auth/src/empresa.ts) primero busca la empresa del correo y sólo la
 * crea si no encuentra ninguna. Si el webhook ya corrió, entra a la suya; si
 * no ha corrido, la crea. En los dos casos el botón funciona — por eso esta
 * página ahora tiene un botón en vez de una promesa.
 *
 * ── El mismo correo. No es un detalle de cortesía ──────────────────────────
 *
 * La empresa que se acaba de pagar queda a nombre del correo que recogió
 * Stripe. Quien entre después con OTRA cuenta de Google no tiene membresía en
 * esa empresa, así que `empresaDe()` no la encuentra y le crea una NUEVA, en
 * plan gratis: pagó y aterriza en un espacio vacío sin lo que compró. Es el
 * ticket de soporte más caro que puede generar esta pantalla, y se evita con
 * una línea de copy. Por eso está en negritas.
 */
export default function Page() {
  return (
    <main id="contenido" className="mx-auto w-full max-w-2xl px-5 py-20 sm:px-6 sm:py-28">
      <p className="eyebrow eyebrow-primary">Pago recibido</p>

      <h1 className="mt-5 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
        Tu espacio ya está listo.
      </h1>

      <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
        Entra con tu cuenta de Google y tu agente maestro te va a hacer unas preguntas para entender
        cómo trabajas. Toma unos minutos y es lo único que necesitas hacer para arrancar.
      </p>

      <p className="mt-6">
        <a
          href={RUTA_DE_ENTRADA}
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Entrar con Google
        </a>
      </p>

      <Card className="glass mt-10">
        <CardContent className="space-y-3 p-6 text-sm leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Usa el mismo correo con el que pagaste</p>
          <p>
            Tu espacio quedó a nombre de ese correo. Si entras con otra cuenta de Google vas a
            aterrizar en un espacio nuevo y vacío, sin lo que acabas de pagar.
          </p>
          <p>
            ¿Algo no cuadra al entrar? Escríbenos a{' '}
            <a
              className="text-foreground underline underline-offset-4"
              href="mailto:hola@abraxa.club"
            >
              hola@abraxa.club
            </a>{' '}
            con el correo que usaste al pagar y lo resolvemos nosotros. Tu pago está registrado: no
            tienes que volver a pagar por ningún motivo.
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
