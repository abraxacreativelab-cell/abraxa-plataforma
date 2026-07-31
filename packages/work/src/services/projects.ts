/**
 * Proyectos — el primer nivel de la jerarquía.
 *
 * Deliberadamente delgado. En GARDEN `projects` cargaba con `company_id`,
 * `lead_id` (FK a empleados), `milestone_id`, color, metadata y un RPC entero
 * (`move_project_company`) para mover un proyecto de empresa arrastrando todas
 * sus tareas. Nada de eso aplica: aquí el usuario tiene UNA empresa, así que un
 * proyecto no se muda a ninguna parte.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { assertOk } from '../data/errors';
import type { Project } from '../domain/types';
import { parseOrThrow } from './parse';
import { projectCreateSchema, projectPatchSchema } from './schemas';

export async function listProjects(ctx: TenantContext): Promise<Project[]> {
  const { data, error } = await tenantDb(ctx)
    .from('projects')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  assertOk(error, 'la lectura de proyectos');
  return (data ?? []) as Project[];
}

async function leerProyecto(ctx: TenantContext, id: string): Promise<Project> {
  const { data, error } = await tenantDb(ctx).from('projects').select('*').eq('id', id).maybeSingle();
  assertOk(error, 'la lectura del proyecto');
  if (!data) throw new PlatformError('NOT_FOUND', 'El proyecto no existe');
  return data as Project;
}

export async function createProject(ctx: TenantContext, input: unknown): Promise<Project> {
  const datos = parseOrThrow(projectCreateSchema, input);
  const { data, error } = await tenantDb(ctx)
    .from('projects')
    .insert({ ...datos, created_by: ctx.userEmail })
    .select()
    .single();

  assertOk(error, 'la creación del proyecto');
  return data as Project;
}

export async function updateProject(ctx: TenantContext, id: string, input: unknown): Promise<Project> {
  const patch = parseOrThrow(projectPatchSchema, input);
  const { data, error } = await tenantDb(ctx)
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();

  assertOk(error, 'la actualización del proyecto');
  if (!data) throw new PlatformError('NOT_FOUND', 'El proyecto no existe');
  return data as Project;
}

/**
 * Borra el proyecto. Sus tareas NO se borran: la FK es `ON DELETE SET NULL` y
 * quedan sueltas.
 *
 * Es la decisión importante de este archivo. Un proyecto es una carpeta, no un
 * dueño: borrar la carpeta no puede llevarse el trabajo de tres semanas. Quien
 * de verdad quiera borrar las tareas las borra, y ese borrado se ve.
 */
export async function deleteProject(ctx: TenantContext, id: string): Promise<{ orphaned: number }> {
  await leerProyecto(ctx, id);

  const { data: sueltas, error: contarError } = await tenantDb(ctx)
    .from('tasks')
    .select('id')
    .eq('project_id', id);
  assertOk(contarError, 'el conteo de tareas del proyecto');

  const { error } = await tenantDb(ctx).from('projects').delete().eq('id', id);
  assertOk(error, 'el borrado del proyecto');

  return { orphaned: ((sueltas ?? []) as Array<{ id: string }>).length };
}
