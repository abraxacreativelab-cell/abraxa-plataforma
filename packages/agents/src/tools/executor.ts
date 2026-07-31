/**
 * Ejecutor de tools. Portado de GARDEN (src/core/tool-executor.ts).
 *
 * Se conservan las dos decisiones buenas del original:
 *
 *   · TIMEOUT POR TOOL. Una tool colgada no puede colgar la conversación.
 *   · UNA TOOL QUE FALLA NO TUMBA LA CORRIDA. El error se le devuelve al modelo
 *     como resultado y el modelo se corrige o lo dice. Reventar el loop entero
 *     porque una consulta falló convierte un problema chico en un silencio.
 *
 * Lo que cambia: el contexto. En GARDEN era `{botId, companyId, companyScope}`;
 * aquí es el `TenantContext` de H1, y es lo que sostiene el criterio #7 —
 * **una tool corrida con el contexto del tenant A no puede leer datos del B**.
 *
 * Ese aislamiento NO lo aplica este archivo: lo aplica cada handler usando
 * `tenantDb(ctx)`, que filtra por `tenant_id` sin que se pueda omitir. Aquí lo
 * único que se garantiza es que el handler reciba el contexto correcto y que
 * jamás pueda recibir otro — por eso `ctx` viaja como parámetro y no como
 * variable de módulo, ni como algo que la tool pueda sobreescribir desde su
 * `input`.
 */
import type { AgentTool, TenantContext } from '@abraxa/db';
import { TIMEOUT_TOOL_MS } from '../config';
import { log } from '../logger';
import type { ToolRegistry } from './registry';

export interface RegistroDeTool {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  ok: boolean;
}

function conTimeout<T>(p: Promise<T>, ms: number, nombre: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`La tool "${nombre}" excedió ${ms}ms y se abortó`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  /**
   * Ejecuta una tool con el contexto del tenant.
   *
   * Nunca lanza: todo camino devuelve un `RegistroDeTool`. El modelo recibe el
   * resultado —o el error— como texto y decide qué hacer.
   */
  async execute(
    ctx: TenantContext,
    name: string,
    input: Record<string, unknown>,
  ): Promise<RegistroDeTool> {
    const inicio = Date.now();
    const tool: AgentTool | undefined = this.registry.get(name);

    if (!tool) {
      log.warn(`el modelo pidió la tool "${name}", que no está registrada`);
      return {
        name,
        input,
        result: { error: `La herramienta "${name}" no existe.` },
        durationMs: 0,
        ok: false,
      };
    }

    try {
      // `ctx` va como primer parámetro y sale de la sesión verificada, no del
      // input del modelo. Es lo que hace imposible que una tool se ejecute con
      // el tenant de alguien más aunque el modelo lo pida.
      const result = await conTimeout(tool.handler(ctx, input), TIMEOUT_TOOL_MS, name);
      const durationMs = Date.now() - inicio;
      log.debug(`tool ${name} ok en ${durationMs}ms`);
      return { name, input, result, durationMs, ok: true };
    } catch (err) {
      const durationMs = Date.now() - inicio;
      const mensaje = err instanceof Error ? err.message : String(err);
      log.error(`tool ${name} falló tras ${durationMs}ms: ${mensaje}`);
      return { name, input, result: { error: mensaje }, durationMs, ok: false };
    }
  }
}
