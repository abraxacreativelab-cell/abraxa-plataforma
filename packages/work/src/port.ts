/**
 * `WorkPort` — lo único que los otros handoffs saben de H9.
 *
 * Lo consumen el nodo `create_task` de las automatizaciones (H8) y las tools
 * del agente maestro (H3). Es una sola función a propósito: si el port
 * expusiera las cuatro vistas y los filtros, cada cambio interno de H9 sería un
 * cambio en el contrato de otros dos handoffs.
 *
 * El aislamiento se aplica DENTRO: `createTask` recibe el `TenantContext` de
 * quien llama y escribe por `tenantDb(ctx)`. Una automatización corrida con el
 * contexto del cliente A no puede crearle una tarea al B.
 */
import type { TenantContext, WorkPort } from '@abraxa/db';
import { createTask } from './services/tasks';

export const workPort: WorkPort = {
  async createTask(
    ctx: TenantContext,
    i: {
      title: string;
      description?: string;
      assignedTo?: string;
      dueDate?: string;
      projectId?: string;
      parentId?: string;
    },
  ): Promise<{ taskId: string }> {
    // El port habla en camelCase (es el contrato cruzado) y las filas en
    // snake_case (es SQL). La traducción vive aquí, en un solo lugar, y no
    // repartida por cada llamador.
    const task = await createTask(ctx, {
      title: i.title,
      description: i.description ?? null,
      assigned_to: i.assignedTo ?? null,
      due_date: i.dueDate ?? null,
      project_id: i.projectId ?? null,
      parent_id: i.parentId ?? null,
    });
    return { taskId: task.id };
  },
};
