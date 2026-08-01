import type { Metadata } from 'next';
import { Card, CardContent } from '@abraxa/ui';
import { FormularioEmpezar } from './_componentes/formulario-empezar';
import { VistaPrevia } from './_componentes/vista-previa';
import { RUTA_DE_ENTRADA } from '../../../../packages/auth/src/identidad';

export const metadata: Metadata = {
  title: 'Tu negocio contesta mientras duermes',
  description:
    'Un equipo de agentes que atiende a tus clientes, da seguimiento y organiza tu operación. ' +
    'Pagas lo que quieras.',
};

/**
 * La landing. Dueño: H10.
 *
 * ── El público ─────────────────────────────────────────────────────────────
 *
 * Un emprendedor mexicano, probablemente solo, que trabaja demasiado y
 * sospecha que podría automatizar algo pero no sabe qué. No vino buscando
 * "una plataforma multi-agente": vino porque se le fue un cliente por no
 * contestar a tiempo.
 *
 * Por eso aquí no aparecen las palabras RAG, multi-agente, orquestación ni
 * LLM. Aparecen las cosas que le pasan un martes.
 *
 * ── Lo que NO se hace aquí ─────────────────────────────────────────────────
 *
 * No hay testimonios, ni logos de clientes, ni métricas de resultados. El
 * producto todavía no tiene un piloto en producción, y una cita inventada es
 * la manera más rápida de perder a alguien que sí revisa. Cuando exista
 * contenido real de un cliente, va aquí y sustituye a "Así se ve".
 *
 * Es un componente de SERVIDOR: sólo el formulario es cliente. La landing
 * tiene que cargar en menos de 2 segundos en un teléfono de gama media, y
 * mandar React para pintar texto estático es la forma más común de no
 * lograrlo.
 */
export default function Page() {
  return (
    <main id="contenido">
      {/* ── Qué es, en una frase ───────────────────────────────────────── */}
      <section className="light-leak light-leak-accent relative overflow-hidden">
        <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-20 sm:px-6 sm:pb-24 sm:pt-28">
          <p className="eyebrow eyebrow-primary">Para quien atiende su negocio solo</p>

          <h1 className="mt-5 max-w-3xl text-balance font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
            Tu negocio contesta mientras duermes
          </h1>

          <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Un equipo de agentes que responde a tus clientes por WhatsApp, da seguimiento a los que
            no volvieron y te deja el día ordenado. Tú decides qué hacen; ellos lo hacen aunque tú
            estés dormido.
          </p>

          <div className="mt-10 max-w-xl" id="empezar">
            <FormularioEmpezar />
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Pagas lo que tú quieras. Sin contrato, sin vendedor, sin llamada.
          </p>

          <YaTengoCuenta />
        </div>
      </section>

      {/* ── Qué cambia en su día ───────────────────────────────────────── */}
      <section className="border-t border-border/60">
        <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-24">
          <h2 className="section-title text-2xl sm:text-3xl">Lo que deja de pasarte</h2>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {CAMBIOS.map((c) => (
              <Card key={c.antes} className="glass h-full">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <p className="text-sm text-muted-foreground line-through decoration-[hsl(var(--muted-foreground)/0.5)]">
                    {c.antes}
                  </p>
                  <p className="text-pretty text-base leading-relaxed text-foreground">
                    {c.despues}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Cómo se ve ─────────────────────────────────────────────────── */}
      <section className="border-t border-border/60">
        <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-24">
          <h2 className="section-title text-2xl sm:text-3xl">Así se ve</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Tu agente maestro te hace unas preguntas el primer día y con eso arma tu operación.
            Después trabaja solo y te avisa lo que importa.
          </p>

          <div className="mt-10">
            <VistaPrevia />
          </div>
        </div>
      </section>

      {/* ── Cuánto cuesta ──────────────────────────────────────────────── */}
      <section className="border-t border-border/60">
        <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-24">
          <h2 className="section-title text-2xl sm:text-3xl">Cuánto cuesta</h2>

          <div className="mt-8 max-w-2xl space-y-5 text-lg leading-relaxed text-muted-foreground">
            <p>
              <span className="text-foreground">Lo que tú quieras dar.</span> Escribes el monto en
              la pantalla de pago y ese es el precio. No hay letras chiquitas.
            </p>
            <p>
              Lo hacemos así porque el producto es nuevo y todavía no sabemos cuánto vale para ti.
              Tú sí. Cuando lo sepamos lo diremos claro, y nunca te vamos a cobrar más de lo que
              aceptaste.
            </p>
          </div>

          <div className="mt-10 max-w-xl">
            <FormularioEmpezar />
            <YaTengoCuenta />
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * La puerta de regreso, junto al formulario.
 *
 * El encabezado ya tiene un "Entrar", pero quien llega a la landing desde un
 * enlace va directo al formulario y lee hacia abajo: en un teléfono, la barra
 * de arriba deja de existir en cuanto hace scroll. El sitio donde de verdad se
 * pregunta "¿y si ya tengo cuenta?" es justo debajo del campo que pide el
 * nombre del negocio — porque es ahí donde alguien que ya se dio de alta se da
 * cuenta de que ese formulario no es para él.
 *
 * Se pinta las dos veces que la landing pinta el formulario. Es `<a>` y no
 * `<Link>` por lo mismo que en el layout: `/api/auth/signin` es un Route
 * Handler, no una página del App Router.
 */
function YaTengoCuenta() {
  return (
    <p className="mt-4 text-sm text-muted-foreground">
      ¿Ya tienes cuenta?{' '}
      <a
        href={RUTA_DE_ENTRADA}
        className="text-foreground underline underline-offset-4 hover:text-primary"
      >
        Entrar
      </a>
    </p>
  );
}

/**
 * Situaciones, no funcionalidades.
 *
 * "Bandeja unificada omnicanal" no le mueve nada a nadie. "Se te fue un
 * cliente porque contestaste al día siguiente" sí, porque le pasó el jueves.
 */
const CAMBIOS = [
  {
    antes: 'Contestas a las 11 de la noche y aun así llegas tarde.',
    despues: 'Tu agente contesta en cuanto entra el mensaje, con tus precios y tu forma de hablar.',
  },
  {
    antes: 'El que preguntó la semana pasada y no volvió, se perdió.',
    despues: 'Alguien le da seguimiento sin que tú te acuerdes de que existía.',
  },
  {
    antes: 'Sabes que algo se está cayendo, pero no sabes qué.',
    despues: 'Abres el día y ya está escrito qué pasó, qué falta y qué decidir.',
  },
];
