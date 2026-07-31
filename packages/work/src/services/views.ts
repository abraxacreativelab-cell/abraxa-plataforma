/**
 * Vistas guardadas.
 *
 * ── Quién ve qué ────────────────────────────────────────────────────────────
 *
 *  · Las tuyas, siempre.
 *  · Las que alguien del tenant marcó como compartidas.
 *
 *  Y nada más. Es el criterio 5 del handoff: *"una vista guardada compartida la
 *  ven los demás miembros del tenant"* — los del tenant, no los de otro.
 *
 *  El aislamiento entre clientes no se escribe aquí: `tenantDb(ctx)` ya acota
 *  todo a `tenant_id`. Lo que sí se escribe es la regla DENTRO del tenant, que
 *  es de personas y no de empresas.
 *
 * ── Lo que se quita de GARDEN ───────────────────────────────────────────────
 *
 *  `task-views.ts` tenía 60 líneas de `SUPER_ADMINS`, `canAccessCompany()` y
 *  `requireCompanyAccess()` leyendo `x-user-company` del navegador. Todo eso lo
 *  resuelve `TenantContext`, que se arma server-side desde una sesión
 *  verificada. Un correo de super-admin escrito en una variable de entorno no
 *  tiene lugar en una plataforma multi-cliente.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { assertOk } from '../data/errors';
import { normalizeViewConfig, normalizeViewKind, type SavedView } from '../domain/view';
import { parseOrThrow } from './parse';
import { viewCreateSchema, viewPatchSchema } from './schemas';

interface FilaVista {
  id: string;
  owner_email: string;
  name: string;
  kind: string;
  config: unknown;
  shared: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Toda vista se normaliza AL LEER, no sólo al escribir. Una fila guardada por
 *  una versión anterior del producto tiene que abrir la pantalla igual, con las
 *  reglas que ya no existen descartadas. */
function aVista(fila: FilaVista): SavedView {
  const kind = normalizeViewKind(fila.kind);
  return {
    id: fila.id,
    owner_email: fila.owner_email,
    name: fila.name,
    kind,
    config: normalizeViewConfig(fila.config, kind),
    shared: fila.shared,
    position: fila.position,
    created_at: fila.created_at,
    updated_at: fila.updated_at,
  };
}

const esMia = (v: SavedView, ctx: TenantContext): boolean =>
  ctx.userEmail != null && v.owner_email === ctx.userEmail;

export async function listViews(ctx: TenantContext): Promise<SavedView[]> {
  const { data, error } = await tenantDb(ctx)
    .from('task_views')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  assertOk(error, 'la lectura de vistas guardadas');

  // El filtro por persona se hace aquí y no en la consulta a propósito: son
  // pocas filas por tenant y una sola consulta evita el `or()` de PostgREST,
  // que es donde se cuela un paréntesis mal puesto que deja ver de más.
  return ((data ?? []) as FilaVista[]).map(aVista).filter((v) => v.shared || esMia(v, ctx));
}

async function leerVista(ctx: TenantContext, id: string): Promise<SavedView> {
  const { data, error } = await tenantDb(ctx).from('task_views').select('*').eq('id', id).maybeSingle();
  assertOk(error, 'la lectura de la vista');
  if (!data) throw new PlatformError('NOT_FOUND', 'La vista no existe');

  const vista = aVista(data as FilaVista);
  if (!vista.shared && !esMia(vista, ctx)) {
    // 404 y no 403: decir "existe pero no es tuya" ya confirma que existe.
    throw new PlatformError('NOT_FOUND', 'La vista no existe');
  }
  return vista;
}

export const getView = leerVista;

export async function createView(ctx: TenantContext, input: unknown): Promise<SavedView> {
  const datos = parseOrThrow(viewCreateSchema, input);
  if (!ctx.userEmail) {
    throw new PlatformError('UNAUTHENTICATED', 'Hace falta una sesión para guardar una vista');
  }

  const { data, error } = await tenantDb(ctx)
    .from('task_views')
    .insert({
      owner_email: ctx.userEmail,
      name: datos.name,
      kind: datos.kind,
      config: normalizeViewConfig(datos.config, datos.kind),
      shared: datos.shared ?? false,
      position: datos.position ?? 0,
    })
    .select()
    .single();

  assertOk(error, 'la creación de la vista');
  return aVista(data as FilaVista);
}

/**
 * Sólo el dueño edita su vista.
 *
 * Que sea compartida la hace visible, no editable por todos. Si cualquiera
 * pudiera reescribir "Mi semana", el resto del equipo abriría mañana una vista
 * que no reconoce — y no habría manera de saber quién la cambió.
 */
export async function updateView(ctx: TenantContext, id: string, input: unknown): Promise<SavedView> {
  const patch = parseOrThrow(viewPatchSchema, input);
  const actual = await leerVista(ctx, id);
  if (!esMia(actual, ctx)) {
    throw new PlatformError('FORBIDDEN', 'Sólo quien creó la vista puede cambiarla');
  }

  const kind = patch.kind ?? actual.kind;
  const fila: Record<string, unknown> = {};
  if (patch.name !== undefined) fila.name = patch.name;
  if (patch.kind !== undefined) fila.kind = patch.kind;
  if (patch.shared !== undefined) fila.shared = patch.shared;
  if (patch.position !== undefined) fila.position = patch.position;
  if (patch.config !== undefined) fila.config = normalizeViewConfig(patch.config, kind);

  const { data, error } = await tenantDb(ctx)
    .from('task_views')
    .update(fila)
    .eq('id', id)
    .select()
    .maybeSingle();

  assertOk(error, 'la actualización de la vista');
  if (!data) throw new PlatformError('NOT_FOUND', 'La vista no existe');
  return aVista(data as FilaVista);
}

export async function deleteView(ctx: TenantContext, id: string): Promise<void> {
  const actual = await leerVista(ctx, id);
  if (!esMia(actual, ctx)) {
    throw new PlatformError('FORBIDDEN', 'Sólo quien creó la vista puede borrarla');
  }
  const { error } = await tenantDb(ctx).from('task_views').delete().eq('id', id);
  assertOk(error, 'el borrado de la vista');
}
