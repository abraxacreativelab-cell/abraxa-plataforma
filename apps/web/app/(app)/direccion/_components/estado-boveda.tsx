import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { BovedaNoDisponible } from '../_lib/session';
import { FalloDeCarga, SinNada } from './ui';

/**
 * Qué enseñar cuando la bóveda todavía no se puede leer.
 *
 * ── Lo que esta pantalla decía antes, y por qué se cambió ──────────────────
 *
 * Pintaba «Falta: H2 · packages/tenancy» debajo del error, y para los fallos
 * que no eran de sesión pintaba `error.message` en monoespaciada. Las dos cosas
 * están mal por la misma razón: quien está mirando es el dueño de un negocio,
 * no quien programó esto.
 *
 * Y la segunda era además una fuga. El error más probable de este camino venía
 * de `usePort()`, cuyo texto literal es:
 *
 *     El port 'tenancy' todavía no está implementado. Lo entrega H2 ·
 *     packages/tenancy. Programa contra la interfaz de packages/db/ports.ts…
 *     (el gate de propiedad falla tu PR).
 *
 * Eso terminaba en el navegador de un cliente. Ahora NADA que venga de un
 * `Error` se pinta: el diagnóstico va al log del servidor y en pantalla queda
 * una frase honesta y una salida.
 *
 * ── La regla que queda ────────────────────────────────────────────────────
 *
 * «No tienes nada» y «no pudimos cargarlo» son cosas distintas y se ven
 * distintas. Un cero cuando en realidad la petición murió es una mentira que le
 * cuesta confianza al producto. Por eso `sin-sesion` y `sin-empresa` —que no
 * son fallos, son pasos que le faltan a la persona— se pintan como una
 * invitación, y sólo lo que de verdad se rompió se pinta como un error.
 */
export function EstadoBoveda({ error }: { error: unknown }) {
  if (error instanceof BovedaNoDisponible) {
    // La pista es para quien opera esto, nunca para la pantalla.
    if (error.pista) console.error(`[direccion] ${error.motivo} — ${error.pista}`);

    const esInvitacion = error.motivo === 'sin-sesion' || error.motivo === 'sin-empresa';

    if (esInvitacion) {
      return (
        <SinNada titulo={error.titulo} descripcion={error.explicacion}>
          {error.accion ? <BotonPrincipal {...error.accion} /> : null}
        </SinNada>
      );
    }

    return (
      <FalloDeCarga titulo={error.titulo} detalle={error.explicacion}>
        {error.accion ? <BotonSecundario {...error.accion} /> : null}
      </FalloDeCarga>
    );
  }

  // Un error que no previmos. Se registra entero y se cuenta en una frase.
  console.error('[direccion] fallo no previsto al cargar la bóveda', error);

  return (
    <FalloDeCarga
      titulo="No pudimos cargar tu bóveda"
      detalle="Es un problema nuestro, no algo que hayas hecho mal. Vuelve a intentarlo en un momento."
    >
      <BotonSecundario texto="Reintentar" href="/direccion" />
    </FalloDeCarga>
  );
}

function BotonPrincipal({ texto, href }: { texto: string; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-transparent bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
    >
      {texto}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function BotonSecundario({ texto, href }: { texto: string; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))]"
    >
      {texto}
    </Link>
  );
}

/**
 * El estado vacío de una bóveda recién creada.
 *
 * ── Por qué no es «no hay nada» y ya ──────────────────────────────────────
 *
 * Es la PRIMERA pantalla de Dirección que ve un cliente nuevo, y hasta hoy era
 * un recuadro punteado con una línea de texto. El ensayo del 2026-07-31 lo dijo
 * sin rodeos: lo que el Ritual promete se pierde al llegar al panel. Una caja
 * vacía no promete nada.
 *
 * Aquí se enseña lo que va a pasar —los tres pasos, en orden, con el ejemplo
 * concreto de un precio que se propaga solo— y se abre con el único botón que
 * importa. No es decoración: es la explicación de por qué vale la pena pegar el
 * primer documento, en el único momento en que el cliente todavía no lo sabe.
 */
export function BovedaVacia() {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[hsl(var(--primary))]/25 bg-[hsl(var(--primary))]/[0.04] p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]" />
          <p className="text-xs font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
            Tu bóveda está lista y vacía
          </p>
        </div>

        <h2 className="mt-3 max-w-xl text-xl font-semibold leading-tight sm:text-2xl">
          Define tus números una vez. Se actualizan en todos lados para siempre.
        </h2>

        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
          Sube el precio de una instalación de $1,500 a $1,800 y cambia en tus cotizaciones, en tus
          contratos y en lo que contestan tus agentes. Sin que andes buscando dónde decía $1,500.
        </p>

        <div className="mt-5">
          <Link
            href="/direccion/ingesta"
            className="inline-flex items-center gap-1.5 rounded-md border border-transparent bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
          >
            Agregar mi primer documento
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
          Sirve cualquier cosa donde tengas precios: una lista, una cotización vieja, hasta un
          mensaje de WhatsApp.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        <Paso
          numero={1}
          titulo="Pegas un documento"
          texto="Tal como lo tengas. No hay formato que aprender."
        />
        <Paso
          numero={2}
          titulo="Te propongo los números"
          texto="Los saco del texto y te los enseño. Nada se usa hasta que tú los apruebes."
        />
        <Paso
          numero={3}
          titulo="Se propagan solos"
          texto="A tus contratos, a tus mensajes y a lo que contestan tus agentes."
        />
      </ol>
    </div>
  );
}

function Paso({ numero, titulo, texto }: { numero: number; titulo: string; texto: string }) {
  return (
    <li className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-4">
      <span className="inline-grid h-6 w-6 place-items-center rounded-full border border-[hsl(var(--primary))]/30 text-xs font-semibold tabular-nums text-[hsl(var(--primary))]">
        {numero}
      </span>
      <p className="mt-2 text-sm font-medium">{titulo}</p>
      <p className="mt-1 text-xs leading-snug text-[hsl(var(--muted-foreground))]">{texto}</p>
    </li>
  );
}
