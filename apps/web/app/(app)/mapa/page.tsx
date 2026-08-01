import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { loadMap, type BusinessMap } from '@abraxa/areas';
import { Badge, Card, EmptyState, Icon } from '@abraxa/ui';
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

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-24">
      <EmptyState
        icon="map"
        title="Tu mapa de negocio todavía no puede cargarse"
        description={motivoSinContexto()}
      />
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
        <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
          {map.empty
            ? 'Aquí va a vivir tu sistema completo conforme lo construyas.'
            : `Tu empresa tiene ${construidas.length} ${
                construidas.length === 1 ? 'área abierta' : 'áreas abiertas'
              }${activas ? `, ${activas} ya funcionando` : ''}. Lo demás se abre solo, conforme avanzas.`}
        </p>
      </header>

      {map.empty ? (
        <EmptyState
          icon="map"
          title="Tu mapa se está armando"
          description="En cuanto tu empresa tenga giro, aquí aparecen sus áreas."
        />
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
