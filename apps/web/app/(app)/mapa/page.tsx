import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { loadMap, type BusinessMap } from '@abraxa/areas';
import { Badge, Button, Card, EmptyState, Icon } from '@abraxa/ui';
import { contextoDelMapa, motivoSinContexto } from './context';
import { mapaDemo } from './demo';
import { AreaCardView } from './ui/area-card';
import { Roadmap } from './ui/roadmap';

export const metadata: Metadata = { title: 'Mapa de negocio · ABRAXA Plataforma' };

/**
 * `/mapa` — El Mapa de Negocio (H11).
 *
 * Componente de SERVIDOR. Arma el `TenantContext` desde la sesión verificada,
 * lee todo lo que la pantalla necesita en una sola pasada —áreas ya
 * reconciliadas, roadmap y señales— y se lo entrega al cliente resuelto.
 *
 * ── Que se sienta un mapa, no una lista de pendientes ───────────────────────
 *
 * Lo que ya construyó tiene que VERSE construido: es el pago de todo el
 * esfuerzo que ha metido. Por eso las abiertas van primero y encendidas, con su
 * acento y sus herramientas; las bloqueadas van al final, apagadas, con candado
 * y con la barra de lo que les falta. La diferencia se lee desde el otro lado
 * del escritorio, sin comparar etiquetas.
 *
 * Y las bloqueadas SE VEN. La curiosidad es el motor: ver "RH · graduarte de
 * solopreneur" cerrado le planta una idea que va a querer.
 */
export default async function Page() {
  const ctx = await contextoDelMapa();

  if (ctx) {
    const map = await loadMap(ctx);
    return <Mapa map={map} editable demo={null} />;
  }

  // ── Sin sesión verificada ────────────────────────────────────────────────
  //
  // En producción se dice y ya. En desarrollo, la cookie `abraxa_mapa_demo`
  // abre la pantalla con datos en memoria — el mismo interruptor que H5 dejó en
  // `(app)/layout.tsx` con `abraxa_shell_demo` y H9 en `/tareas`, y por la misma
  // razón: poder verificar los criterios visuales del handoff sin esperar a
  // otro carril.
  //
  // El orden importa: en producción esto NI SIQUIERA lee la cookie.
  if (process.env.NODE_ENV !== 'production' && cookies().get('abraxa_mapa_demo')?.value === '1') {
    return <Mapa map={mapaDemo()} editable={false} demo="datos de prueba · no es tu empresa" />;
  }

  const motivo = motivoSinContexto();
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-24">
      <EmptyState icon="map" title={motivo.titulo} description={motivo.descripcion}>
        {motivo.accion && (
          <Button asChild>
            <Link href={motivo.accion.href}>{motivo.accion.texto}</Link>
          </Button>
        )}
      </EmptyState>
    </main>
  );
}

// ════════════════════════════════════════════════════════════════════════════

function Mapa({
  map,
  editable,
  demo,
}: {
  map: BusinessMap;
  editable: boolean;
  demo: string | null;
}) {
  // Las abiertas primero. No es un capricho de orden: es que lo suyo se vea
  // antes que lo que le falta.
  const construidas = map.areas.filter((a) => a.state !== 'bloqueada');
  const porVenir = map.areas.filter((a) => a.state === 'bloqueada');
  const activas = map.areas.filter((a) => a.state === 'activa').length;

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 lg:py-14">
      <header className="mb-10">
        {demo && (
          <Badge variant="warning" className="mb-4">
            {demo}
          </Badge>
        )}
        <p className="eyebrow text-muted-foreground">Tu sistema</p>
        <h1 className="section-title mt-2 text-3xl font-light tracking-tight sm:text-4xl">
          Mapa de negocio
        </h1>
        {!map.empty && (
          <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
            Tu empresa tiene {construidas.length}{' '}
            {construidas.length === 1 ? 'área abierta' : 'áreas abiertas'}
            {activas > 0 ? `, ${activas} ya funcionando` : ''}. Lo demás se abre solo, conforme
            avanzas.
          </p>
        )}
      </header>

      {map.empty ? (
        <MapaPorNacer />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
          <div className="space-y-10">
            {construidas.length > 0 && (
              <Seccion titulo="Lo que ya tienes" cuenta={construidas.length}>
                {construidas.map((a) => (
                  <AreaCardView key={a.slug} area={a} />
                ))}
              </Seccion>
            )}

            {porVenir.length > 0 && (
              <Seccion
                titulo="Lo que viene"
                cuenta={porVenir.length}
                nota="Se abren solas al cumplir lo que piden. No hay que apretar nada."
              >
                {porVenir.map((a) => (
                  <AreaCardView key={a.slug} area={a} />
                ))}
              </Seccion>
            )}
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <Roadmap inicial={map.milestones} editable={editable} />
          </aside>
        </div>
      )}

      {!map.empty && <Senales map={map} />}
    </main>
  );
}

/**
 * Una empresa recién creada, sin una sola área todavía.
 *
 * ── Por qué esto NO es un `EmptyState` de una línea ────────────────────────
 *
 * Porque es el estado en que el invitado llega, y llegar a un recuadro punteado
 * que dice «Tu mapa se está armando» es exactamente el «se pierde todo al llegar
 * al panel» del ensayo. Un mapa vacío no es un error del que disculparse: es el
 * minuto cero de un negocio, y el producto tiene UNA cosa que ofrecerle ahí —el
 * Ritual— así que la ofrece, con el nombre de lo que va a recibir.
 *
 * Las cuatro áreas que se enseñan son las de la plantilla `general` de la 033,
 * que es la que le toca a quien todavía no ha dicho a qué se dedica. No son un
 * adorno: son la promesa concreta de lo que va a tener en veinte minutos, y son
 * el mismo motor que las bloqueadas del mapa lleno — la curiosidad.
 */
function MapaPorNacer() {
  const AREAS = [
    { icon: 'target', label: 'Ventas', blurb: 'Cómo llega un cliente y cómo se cierra la venta.' },
    { icon: 'wrench', label: 'Operaciones', blurb: 'Cómo se entrega lo que vendes.' },
    { icon: 'wallet', label: 'Finanzas', blurb: 'Qué entra, qué sale y cuánto queda.' },
    { icon: 'compass', label: 'Dirección', blurb: 'Los números y los documentos del negocio.' },
  ];

  return (
    <Card className="p-8 sm:p-10">
      <div className="mx-auto max-w-xl text-center">
        <span className="glass-btn mx-auto grid h-12 w-12 place-items-center rounded-xl text-primary">
          <Icon name="map" className="h-6 w-6" />
        </span>
        <h2 className="mt-5 text-xl font-light tracking-tight sm:text-2xl">
          Tu mapa se dibuja contigo
        </h2>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
          Tu agente te va a hacer unas preguntas sobre tu negocio —a qué te dedicas, cómo cobras,
          qué te quita el sueño— y con eso arma las áreas que TU negocio necesita. No es un
          formulario: es una conversación, y al final esta pantalla es tuya.
        </p>
        <Button asChild className="mt-6">
          <Link href="/ritual">Empezar con mi agente</Link>
        </Button>
      </div>

      <div className="mt-10">
        <div className="mb-4 flex items-baseline gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Lo que va a aparecer aquí
          </h3>
          <span className="hairline h-px flex-1" aria-hidden />
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {AREAS.map((a) => (
            <li
              key={a.label}
              className="flex items-start gap-3 rounded-lg border border-dashed border-border/60 p-4"
            >
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/60 text-muted-foreground">
                <Icon name={a.icon} className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium leading-tight">{a.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">{a.blurb}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground/60">
          Y las que tu giro pida además: inventario si vendes producto, atención a clientes si te
          escriben todo el día, equipo cuando dejes de estar solo.
        </p>
      </div>
    </Card>
  );
}

function Seccion({
  titulo,
  cuenta,
  nota,
  children,
}: {
  titulo: string;
  cuenta: number;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {titulo}
        </h2>
        <span className="hairline h-px flex-1" aria-hidden />
        <span className="font-mono text-xs text-muted-foreground/60">{cuenta}</span>
      </div>
      {nota && <p className="-mt-1 mb-4 text-xs text-muted-foreground/70">{nota}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * Los números con los que se evalúa todo lo de arriba.
 *
 * Están a la vista a propósito: cuando un área no se abre, el emprendedor tiene
 * derecho a ver EL MISMO dato que el sistema está mirando. Un candado que dice
 * "tienes 5 contactos activos" sin enseñar que va en 3 es un candado que pide fe.
 */
function Senales({ map }: { map: BusinessMap }) {
  const filas: Array<[string, number]> = [
    ['Canales conectados', map.signals.channels_active],
    ['Etapas de embudo', map.signals.pipeline_stages],
    ['Valores vigentes', map.signals.values_active],
    ['Documentos', map.signals.documents],
    ['Contactos activos', map.signals.contacts_active],
    ['Ventas cerradas', map.signals.deals_won],
    ['Meses operando', map.signals.months_operating],
  ];

  return (
    <section className="mt-12">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Con qué se mide
        </h2>
        <span className="hairline h-px flex-1" aria-hidden />
      </div>
      <Card className="p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
          {filas.map(([etiqueta, valor]) => (
            <div key={etiqueta}>
              <dt className="text-xs leading-tight text-muted-foreground">{etiqueta}</dt>
              <dd className="tabular mt-1 text-2xl font-light">{valor}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground/70">
          <Icon name="help" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Éstos son los números que el sistema mira para abrir tus áreas. Se actualizan solos
          conforme trabajas.
        </p>
      </Card>
    </section>
  );
}
