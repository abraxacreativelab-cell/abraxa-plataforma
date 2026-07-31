import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Badge, EmptyState } from '@abraxa/ui';
import { loadWorkspace } from '@abraxa/work';
import { locationFromParams } from '@abraxa/work/domain';
import { contextoDeTareas, motivoSinContexto } from './context';
import { semillaDemo } from './demo';
import { Workspace, type DatosIniciales } from './ui/workspace';

export const metadata: Metadata = { title: 'Tareas · ABRAXA Plataforma' };

/**
 * `/tareas` — H9.
 *
 * Componente de SERVIDOR. Arma el `TenantContext` desde la sesión verificada,
 * lee todo lo que la pantalla necesita en una sola pasada y se lo entrega al
 * cliente ya resuelto. La navegación entre vistas, los filtros y el panel de
 * detalle pasan después en el navegador, sin volver al servidor a leer.
 *
 * El estado inicial sale de la URL (`locationFromParams`): abrir el enlace de
 * una vista filtrada en otra pestaña muestra lo mismo desde el primer pintado,
 * no después de un parpadeo. Es el criterio observable 2 del handoff.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await contextoDeTareas();
  const ahoraISO = new Date().toISOString();

  if (ctx) {
    const ws = await loadWorkspace(ctx);
    const datos: DatosIniciales = {
      tasks: ws.tasks,
      projects: ws.projects,
      views: ws.views,
      members: ws.members,
      truncated: ws.truncated,
      teamDegraded: ws.teamDegraded,
    };
    return (
      <Workspace
        inicial={datos}
        ubicacion={locationFromParams(searchParams, ws.views)}
        userEmail={ctx.userEmail}
        ahoraISO={ahoraISO}
        demo={null}
      />
    );
  }

  // ── Sin sesión verificada ────────────────────────────────────────────────
  //
  // En producción se dice y ya. En desarrollo, la cookie `abraxa_work_demo`
  // abre la pantalla con datos en memoria — el mismo interruptor que H5 dejó en
  // `(app)/layout.tsx` con `abraxa_shell_demo`, y por la misma razón: poder
  // verificar los criterios del handoff sin esperar a otro carril.
  //
  // El orden importa: en producción esto NI SIQUIERA lee la cookie.
  if (process.env.NODE_ENV !== 'production' && cookies().get('abraxa_work_demo')?.value === '1') {
    const semilla = semillaDemo();
    return (
      <Workspace
        inicial={{
          tasks: semilla.tasks,
          projects: semilla.projects,
          views: semilla.views,
          members: semilla.members,
          truncated: false,
          teamDegraded: false,
        }}
        ubicacion={locationFromParams(searchParams, semilla.views)}
        userEmail={semilla.userEmail}
        ahoraISO={ahoraISO}
        demo={{
          tasks: semilla.tasks,
          projects: semilla.projects,
          views: semilla.views,
          comments: semilla.comments,
          events: semilla.events,
          userEmail: semilla.userEmail,
        }}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-24">
      <EmptyState
        icon="lock"
        title="Tareas todavía no puede abrir"
        description={`${motivoSinContexto()} Sin sesión verificada no se puede saber de qué empresa son las tareas, y ese 403 es lo único que impide que un cliente vea las de otro.`}
      >
        <div className="space-y-3 text-left">
          <p className="text-xs text-muted-foreground">
            El módulo está construido y probado: modelo de datos, las cuatro vistas, filtros, vistas
            guardadas, panel de detalle, el guard 409 y el reorder transaccional. Sólo le falta con quién
            hablar.
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            <Badge variant="secondary">Proyecto</Badge>
            <Badge variant="secondary">Responsable</Badge>
            <Badge variant="secondary">Calendario</Badge>
            <Badge variant="secondary">Progreso</Badge>
          </div>
          {process.env.NODE_ENV !== 'production' && (
            <p className="text-xs text-muted-foreground/70">
              En desarrollo:{' '}
              <code className="text-foreground">document.cookie = &apos;abraxa_work_demo=1&apos;</code> y
              recarga para verla con datos de ejemplo.
            </p>
          )}
        </div>
      </EmptyState>
    </main>
  );
}
