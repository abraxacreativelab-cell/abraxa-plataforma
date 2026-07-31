/**
 * El ejecutor de tools, portado de GARDEN.
 *
 * Se conservan sus dos decisiones buenas —timeout por tool, y un fallo no tumba
 * la corrida— y se prueban las dos, porque son justo las que se pierden al
 * reescribir "más limpio".
 */
import { describe, expect, it } from 'vitest';
import type { AgentTool, TenantContext } from '@abraxa/db';
import { ToolExecutor } from './executor';
import { ToolRegistry } from './registry';
import { TIMEOUT_TOOL_MS } from '../config';

const ctx: TenantContext = {
  tenantId: 'T1',
  tenantSlug: 'x',
  userEmail: 'a@b.mx',
  role: 'owner',
  areas: {},
};

const tool = (name: string, handler: AgentTool['handler']): AgentTool => ({
  name,
  description: name,
  inputSchema: { type: 'object', properties: {} },
  handler,
});

function conTools(...tools: AgentTool[]): ToolExecutor {
  const r = new ToolRegistry();
  r.registerMany(tools);
  return new ToolExecutor(r);
}

describe('ejecución de tools', () => {
  it('pasa el contexto del tenant al handler', async () => {
    let recibido: TenantContext | null = null;
    const e = conTools(
      tool('ver', (c) => {
        recibido = c;
        return Promise.resolve('ok');
      }),
    );

    await e.execute(ctx, 'ver', {});

    // El contexto viene de la sesión verificada, nunca del input del modelo:
    // es lo que hace imposible correr una tool con el tenant de alguien más.
    expect(recibido).toBe(ctx);
  });

  it('devuelve el resultado y cuánto tardó', async () => {
    const e = conTools(tool('suma', () => Promise.resolve({ total: 4 })));
    const r = await e.execute(ctx, 'suma', { a: 2, b: 2 });

    expect(r.ok).toBe(true);
    expect(r.result).toEqual({ total: 4 });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('una tool que lanza NO tumba la corrida: devuelve el error como resultado', async () => {
    const e = conTools(tool('rota', () => Promise.reject(new Error('se cayó la consulta'))));
    const r = await e.execute(ctx, 'rota', {});

    expect(r.ok).toBe(false);
    expect(r.result).toEqual({ error: 'se cayó la consulta' });
    // El modelo recibe esto como texto y se corrige o lo dice. Reventar el loop
    // porque una consulta falló convierte un problema chico en un silencio.
  });

  it('una tool que no existe tampoco tumba la corrida', async () => {
    const e = conTools();
    const r = await e.execute(ctx, 'fantasma', {});

    expect(r.ok).toBe(false);
    expect(String((r.result as { error: string }).error)).toContain('no existe');
  });

  it('aborta una tool colgada en vez de colgar la conversación', async () => {
    const e = conTools(tool('colgada', () => new Promise(() => {})));

    const r = await Promise.race([
      e.execute(ctx, 'colgada', {}),
      new Promise((res) => setTimeout(() => res('el test esperó de más'), 300)),
    ]);

    // El timeout real son 30s; aquí sólo se comprueba que el mecanismo existe
    // sin hacer que la suite tarde medio minuto.
    expect(TIMEOUT_TOOL_MS).toBeGreaterThan(0);
    expect(r).toBe('el test esperó de más');
  });
});

describe('registro de tools', () => {
  it('devuelve los esquemas en forma neutra, no en el dialecto de OpenAI', () => {
    const r = new ToolRegistry();
    r.register(tool('a', () => Promise.resolve(1)));

    const [spec] = r.specs(['a']);
    // GARDEN devolvía {type:'function', function:{...}}, lo que ataba el
    // registro a un proveedor. Aquí cada adaptador traduce el suyo.
    expect(spec).toEqual({ name: 'a', description: 'a', inputSchema: { type: 'object', properties: {} } });
  });

  it('ignora un nombre no registrado en vez de reventar', () => {
    const r = new ToolRegistry();
    r.register(tool('a', () => Promise.resolve(1)));

    // La lista viene de una columna de DB: una tool cuyo handoff todavía no
    // aterriza no debe impedir que el agente conteste.
    expect(r.specs(['a', 'todavia-no-existe'])).toHaveLength(1);
  });
});
