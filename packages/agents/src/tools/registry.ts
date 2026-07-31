/**
 * Registro de tools. Portado de GARDEN (src/core/tool-registry.ts, 55 líneas).
 *
 * Genérico casi tal cual. Dos cambios al portarlo:
 *
 *   · Los esquemas salen en forma NEUTRA (`ToolSpec`), no en el formato de
 *     función de OpenAI. GARDEN devolvía `{type:'function', function:{...}}`
 *     directamente, lo que ataba el registro a un dialecto; aquí cada adaptador
 *     traduce el suyo. Es lo que permite que el mismo agente corra en Anthropic
 *     o en OpenRouter cambiando una columna.
 *
 *   · `ExecutionContext` pasa a ser el `TenantContext` de H1, y el handler lo
 *     recibe. El aislamiento se aplica DENTRO de cada handler con
 *     `tenantDb(ctx)`, que es la firma que declara `AgentTool` en ports.ts.
 *
 * Cada handoff registra las SUYAS desde su propio paquete: H4 la de bóveda, H6
 * la de mensajería, H8 la de flows. Nadie edita un registro central — ésa es
 * toda la idea, y por eso `registerTool` está en `AgentPort`.
 */
import type { AgentTool } from '@abraxa/db';
import type { ToolSpec } from '../providers/types';
import { log } from '../logger';

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      log.warn(`la tool "${tool.name}" ya estaba registrada; se sobreescribe`);
    }
    this.tools.set(tool.name, tool);
    log.debug(`tool registrada: ${tool.name}`);
  }

  registerMany(tools: AgentTool[]): void {
    for (const t of tools) this.register(t);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Esquemas de las tools pedidas, en forma neutra.
   *
   * Un nombre que no existe se ignora en silencio a propósito: la lista viene
   * de la columna `tools` de una fila de DB, y una tool que todavía no registra
   * su handoff no debe impedir que el agente conteste. Sí queda en el log.
   */
  specs(nombres?: string[]): ToolSpec[] {
    const seleccion = nombres
      ? nombres
          .map((n) => {
            const t = this.tools.get(n);
            if (!t) log.debug(`la tool "${n}" está en la fila del agente pero no está registrada`);
            return t;
          })
          .filter((t): t is AgentTool => t !== undefined)
      : Array.from(this.tools.values());

    return seleccion.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  get size(): number {
    return this.tools.size;
  }

  /** Sólo para pruebas. */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * El registro del proceso.
 *
 * Global a propósito: las tools son del CÓDIGO (las registra cada paquete al
 * cargarse), no del cliente. Lo que es del cliente es CUÁLES ve su agente, y
 * eso vive en la columna `tools` de su fila.
 */
export const toolRegistry = new ToolRegistry();
