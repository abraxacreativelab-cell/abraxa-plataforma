/**
 * Traducción de los errores de la base a errores de dominio.
 *
 * La migración 070 pone tres invariantes dentro de Postgres —el guard de las
 * subtareas abiertas, el nivel único de la jerarquía y la pertenencia al
 * tenant— y los levanta con mensajes con prefijo (`open_subtasks:`,
 * `subtask_depth:`, …).
 *
 * Están en la base y no sólo en el código porque el código no es el único
 * cliente: escriben tareas el port de H9, el nodo `create_task` de H8 y las
 * tools del agente maestro. Un invariante que sólo vive en una ruta HTTP es un
 * invariante que se rompe por la puerta de al lado.
 *
 * Aquí se convierten en `PlatformError` para que la capa de transporte les
 * ponga su código HTTP sin conocer una sola palabra de Postgres.
 */
import { PlatformError } from '@abraxa/db';

/** La forma del error que devuelve supabase-js. */
export interface DbError {
  message?: string | null;
  code?: string | null;
  details?: string | null;
}

const prefijo = (mensaje: string, marca: string): string | null =>
  mensaje.startsWith(marca) ? mensaje.slice(marca.length) : null;

/**
 * `open_subtasks:` es el único que se traduce con carga útil: la lista de ids
 * viaja en `details` para que la ruta la pueda devolver en el cuerpo del 409 y
 * la pantalla ofrezca "Completar todas".
 */
export function mapDbError(error: DbError | null | undefined, contexto: string): PlatformError | null {
  if (!error) return null;
  const mensaje = String(error.message ?? '');

  const abiertas = prefijo(mensaje, 'open_subtasks:');
  if (abiertas !== null) {
    return new PlatformError(
      'CONFLICT',
      'La tarea tiene subtareas abiertas. Ciérralas o complétalas todas.',
      { details: { openSubtaskIds: abiertas.split(',').filter(Boolean) } },
    );
  }

  const noExiste = prefijo(mensaje, 'task_not_found:');
  if (noExiste !== null) return new PlatformError('NOT_FOUND', 'La tarea no existe');

  if (mensaje.startsWith('project_not_found:')) {
    return new PlatformError('VALIDATION', 'El proyecto seleccionado no existe');
  }
  if (mensaje.startsWith('parent_not_found:')) {
    return new PlatformError('VALIDATION', 'La tarea padre no existe');
  }
  if (mensaje.startsWith('subtask_depth:')) {
    return new PlatformError(
      'VALIDATION',
      'Sólo hay un nivel de subtareas: una subtarea no puede tener subtareas.',
    );
  }
  if (mensaje.startsWith('has_subtasks:')) {
    return new PlatformError(
      'VALIDATION',
      'Esta tarea ya tiene subtareas, así que no puede convertirse en subtarea de otra.',
    );
  }
  if (mensaje.startsWith('invalid_')) {
    return new PlatformError('VALIDATION', mensaje);
  }

  // 23514 check_violation · 23503 foreign_key_violation · 22P02 invalid_text_representation
  if (error.code === '23514' || error.code === '23503' || error.code === '22P02') {
    return new PlatformError('VALIDATION', 'Los datos de la tarea no son válidos');
  }
  // 23505 unique_violation — hoy sólo lo puede disparar el nombre de una vista.
  if (error.code === '23505') {
    return new PlatformError('CONFLICT', 'Ya tienes una vista guardada con ese nombre');
  }

  return new PlatformError('INTERNAL', `Falló ${contexto}`, {
    details: { code: error.code ?? null, message: mensaje },
  });
}

/** Lanza si hay error. El caso normal es que no lo haya, y así el llamador no
 *  tiene que escribir un `if` por cada consulta. */
export function assertOk(error: DbError | null | undefined, contexto: string): void {
  const mapeado = mapDbError(error, contexto);
  if (mapeado) throw mapeado;
}
