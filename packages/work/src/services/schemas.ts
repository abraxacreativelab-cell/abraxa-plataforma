/**
 * La frontera entre "lo que llegó por la red" y el dominio.
 *
 * Todo lo que entra pasa por aquí antes de tocar `tenantDb`. Los esquemas son
 * `.strict()` a propósito: un campo que no está declarado no se ignora, se
 * rechaza. Un `passthrough()` es cómo un `tenant_id` de un payload ajeno llega
 * hasta el INSERT — `stampTenant` lo pisaría, pero no hay razón para dejar que
 * llegue tan lejos.
 */
import { z } from 'zod';
import { PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from '../domain/types';
import { VIEW_KINDS } from '../domain/view';

/**
 * `YYYY-MM-DD`. Es una fecha de calendario, no un instante: "vence el 3 de
 * agosto" no cambia porque el usuario esté de viaje.
 *
 * La existencia se comprueba dando la vuelta completa (construir y volver a
 * leer), y NO con `Date.parse`: `Date.parse('2026-02-31')` no devuelve `NaN`
 * como uno esperaría — el analizador de respaldo de V8 lo desborda al 3 de
 * marzo y lo da por bueno. Así, un 31 de febrero entraba a la base y reaparecía
 * en el calendario en otro mes.
 */
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'la fecha debe ser YYYY-MM-DD')
  .refine((v) => {
    const [a, m, d] = v.split('-').map(Number);
    if (a === undefined || m === undefined || d === undefined) return false;
    const dt = new Date(Date.UTC(a, m - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'esa fecha no existe en el calendario');

const texto = (max: number) => z.string().trim().max(max);
const textoRequerido = (max: number) => z.string().trim().min(1).max(max);

/** El correo se guarda siempre en minúsculas: `Ana@x.mx` y `ana@x.mx` son la
 *  misma persona, y si se guardan distinto la vista "por responsable" le abre
 *  dos columnas. */
const correo = z
  .string()
  .trim()
  .toLowerCase()
  .email('el responsable debe ser un correo');

const etiquetas = z.array(textoRequerido(40)).max(20);

export const taskCreateSchema = z
  .object({
    title: textoRequerido(300),
    description: texto(10_000).nullish(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    assigned_to: correo.nullish(),
    start_date: fecha.nullish(),
    due_date: fecha.nullish(),
    estimate_hours: z.number().nonnegative().max(10_000).nullish(),
    tags: etiquetas.optional(),
    project_id: z.string().uuid().nullish(),
    parent_id: z.string().uuid().nullish(),
    sort_order: z.number().finite().optional(),
  })
  .strict();

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

/**
 * El patch. `.partial()` sobre el create, más los campos que sólo se pueden
 * cambiar y no crear.
 *
 * `completed_at` NO está: lo pone el trigger `tasks_guard_hierarchy` según el
 * estado. En GARDEN se escribía a mano desde la ruta, y por eso una tarea
 * reabierta se quedaba con la fecha en que se había completado.
 */
export const taskPatchSchema = taskCreateSchema
  .partial()
  .extend({ title: textoRequerido(300).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'el patch no puede estar vacío');

export type TaskPatchInput = z.infer<typeof taskPatchSchema>;

export const projectCreateSchema = z
  .object({
    name: textoRequerido(200),
    description: texto(10_000).nullish(),
    goal: texto(1_000).nullish(),
    status: z.enum(PROJECT_STATUSES).optional(),
    icon: texto(40).nullish(),
    start_date: fecha.nullish(),
    target_date: fecha.nullish(),
    position: z.number().finite().optional(),
  })
  .strict();

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;

export const projectPatchSchema = projectCreateSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'el patch no puede estar vacío');

export type ProjectPatchInput = z.infer<typeof projectPatchSchema>;

export const commentSchema = z.object({ body: textoRequerido(5_000) }).strict();

/**
 * La configuración de una vista se acepta como JSON libre y se NORMALIZA al
 * leerla y al escribirla (`normalizeViewConfig`). Validarla campo por campo con
 * zod duplicaría esa lógica en dos lugares que después se separan.
 */
export const viewCreateSchema = z
  .object({
    name: textoRequerido(80),
    kind: z.enum(VIEW_KINDS),
    config: z.record(z.unknown()).optional(),
    shared: z.boolean().optional(),
    position: z.number().finite().optional(),
  })
  .strict();

export type ViewCreateInput = z.infer<typeof viewCreateSchema>;

export const viewPatchSchema = viewCreateSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'el patch no puede estar vacío');

export type ViewPatchInput = z.infer<typeof viewPatchSchema>;

/**
 * El tope es `LIMITE_TAREAS` (2000, el mismo de `listTasks`) y no un número
 * menor porque un solo arrastre puede tener que renumerar una columna entera:
 * cuando entre dos vecinos ya no cabe ningún número, `planDrop` manda la
 * columna con posiciones enteras en el MISMO lote, para que la corrección sea
 * una transacción y no N escrituras sueltas. Un tope por debajo del máximo que
 * la pantalla puede llegar a mostrar convertiría ese arreglo en un 400.
 */
export const reorderSchema = z.object({ moves: z.array(z.unknown()).min(1).max(2_000) }).strict();
