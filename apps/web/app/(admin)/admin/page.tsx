import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Panel de agencia' };

/** Ver el comentario de `(admin)/layout.tsx`: la decisión de acceso no se cachea. */
export const dynamic = 'force-dynamic';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `/admin` — el índice del panel de agencia. Dueño: H14.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  No es un tablero de métricas de vanidad. Los cuatro paneles de aquí abajo
 *  responden una sola pregunta —**qué está roto ahora**— y están en el orden en
 *  que sirven para arreglarlo. El acceso ya quedó resuelto en el layout: si
 *  esta pantalla se pinta, quien la ve es del equipo.
 *
 *  ── Por qué hoy todo dice "—" y no "0" ─────────────────────────────────────
 *
 *  Los cuatro paneles leen datos de VARIAS empresas a la vez, y eso es
 *  exactamente lo que `tenantDb(ctx)` existe para impedir: cada consulta queda
 *  encerrada en UNA empresa, y ésa es la única razón por la que el aislamiento
 *  entre clientes se sostiene hoy. Saltárselo con `adminDb()` o con el cliente
 *  crudo "para poder ver todo" sería abrir el primer agujero real entre
 *  clientes del proyecto — y sería este carril quien lo abriera.
 *
 *  Así que no se abre. La lectura cruzada está pedida como handoff, con la
 *  consulta concreta escrita, para que la construya quien es dueño del
 *  aislamiento y con su prueba adversarial. Mientras tanto cada panel enseña
 *  "—", que es la verdad: **no hay dato**. Un cero diría "no hay canales
 *  caídos" y llevaría a no revisar nada, que es la peor decisión posible con
 *  esta información. Es la regla que GARDEN acertó en `app/empresas` y el
 *  criterio 8 del handoff.
 */

/** Lo que un panel sabe hoy. `null` es "no hay dato", y se pinta "—". */
interface Panel {
  titulo: string;
  pregunta: string;
  valor: number | null;
  unidad?: string;
  /** Por qué no hay dato. Sin esto, un "—" es tan opaco como un cero falso. */
  falta: string;
}

const PANELES: Panel[] = [
  {
    titulo: 'Necesita atención',
    pregunta:
      'Canales desconectados, workflows fallando, webhooks con error y empresas sin actividad en 7 días.',
    valor: null,
    unidad: 'pendientes',
    falta: 'Requiere leer canales y corridas de todas las empresas a la vez.',
  },
  {
    titulo: 'Consumo de IA',
    pregunta: 'Gasto de hoy contra el promedio, por empresa. Alerta al 80 % del plan.',
    valor: null,
    unidad: 'USD hoy',
    falta: 'Requiere agregar `usage_ledger` de todas las empresas.',
  },
  {
    titulo: 'Altas recientes',
    pregunta: 'Quién entró, si terminó el Ritual de Fundación y en qué fase se quedó.',
    valor: null,
    unidad: 'esta semana',
    falta: 'Requiere leer el avance del Ritual (H7) de todas las empresas.',
  },
  {
    titulo: 'Salud',
    pregunta: 'Latencia, errores y colas atascadas.',
    valor: null,
    unidad: 'incidentes',
    falta: 'Requiere las métricas del worker y de la API, que hoy nadie expone.',
  },
];

export default function PanelDeAgencia() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Qué está roto ahora</h1>
        <p className="max-w-2xl text-muted-foreground">
          Operar cincuenta clientes se sostiene en atrapar los problemas antes de que el
          emprendedor los reporte. Este panel existe para eso y no para presumir números.
        </p>
      </section>

      <section aria-labelledby="paneles" className="flex flex-col gap-4">
        <h2 id="paneles" className="sr-only">
          Paneles
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {PANELES.map((panel) => (
            <TarjetaPanel key={panel.titulo} panel={panel} />
          ))}
        </div>
      </section>

      <SinFuenteTodavia />
    </div>
  );
}

function TarjetaPanel({ panel }: { panel: Panel }) {
  const hayDato = panel.valor !== null;

  return (
    <article className="glass flex flex-col gap-3 rounded-lg p-6">
      <header className="flex flex-col gap-1">
        <h3 className="font-semibold leading-none tracking-tight">{panel.titulo}</h3>
        <p className="text-sm text-muted-foreground">{panel.pregunta}</p>
      </header>

      <p className="flex items-baseline gap-2">
        {/*
          El guion largo se lee «no hay dato» y el `aria-label` lo dice con
          todas sus letras, porque un lector de pantalla anunciaría «—» como
          silencio o como un guion suelto.
        */}
        <span
          aria-label={hayDato ? undefined : 'sin dato'}
          className={
            hayDato
              ? 'font-mono text-4xl font-semibold tabular-nums'
              : 'font-mono text-4xl font-semibold text-muted-foreground'
          }
        >
          {hayDato ? panel.valor : '—'}
        </span>
        {panel.unidad ? (
          <span className="text-sm text-muted-foreground">{panel.unidad}</span>
        ) : null}
      </p>

      {hayDato ? null : <p className="text-xs text-muted-foreground">{panel.falta}</p>}
    </article>
  );
}

/**
 * La pieza que falta, dicha en la pantalla y no sólo en el PR.
 *
 * Quien abra este panel en las próximas semanas va a preguntarse por qué no hay
 * números. La respuesta está aquí, con nombre y forma de lo que se pidió, para
 * que nadie la deduzca — ni, peor, la resuelva por su cuenta saltándose
 * `tenantDb()`.
 */
function SinFuenteTodavia() {
  return (
    <section
      aria-labelledby="sin-fuente"
      className="rounded-lg border border-dashed border-border p-6"
    >
      <h2 id="sin-fuente" className="font-semibold tracking-tight">
        Por qué no hay números todavía
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Los cuatro paneles necesitan leer varias empresas a la vez, y en esta plataforma cada
        consulta va encerrada en una sola empresa por <code className="text-foreground">tenantDb(ctx)</code>.
        Ése es el motivo por el que el aislamiento entre clientes se sostiene, así que este panel{' '}
        <strong className="font-medium text-foreground">no</strong> se lo salta: la lectura cruzada
        está pedida como handoff —cuatro consultas agregadas, de sólo lectura, sin datos de negocio
        de ningún cliente— para que la escriba quien es dueño del aislamiento y con su prueba
        adversarial.
      </p>
      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        Hasta que exista, cada panel enseña «—» y no un cero. Un cero diría «no hay nada roto» y
        haría que nadie fuera a revisar.
      </p>
    </section>
  );
}
