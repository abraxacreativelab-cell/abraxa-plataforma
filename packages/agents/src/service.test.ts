/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los criterios observables de H3, de punta a punta.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *    #1  crear un agent_definition y que responda SIN redeploy
 *    #2  cambiar provider de anthropic a openrouter en la fila y que siga
 *    #3  cada llamada escribe una fila con costo real  (+ compute.test.ts)
 *    #5  al rebasar el presupuesto lanza BudgetExceeded, no degrada
 *    #6  dos tenants con el mismo rol son independientes
 *    #7  una tool del tenant A no puede leer del B
 *
 * Corren sin red y sin base: `__setClientForTests` (gancho de H1) mete una base
 * en memoria y los adaptadores reciben su `fetch` por parámetro. Es también
 * como corre CI, donde no hay `.env`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests, PlatformError, tenantDb } from '@abraxa/db';
import type { AgentTool, TenantContext } from '@abraxa/db';
import { createAgentService } from './service';
import { createProviderRouter } from './providers/router';
import { createStaticPricingCatalog, type PricingRow } from './pricing/catalog';
import { createFakeDb, type FakeDb } from './testing/fake-db';
import { createFakeAdapter, usage } from './testing/fakes';
import { estadoPresupuesto, invalidarCachePresupuesto } from './ledger/budget';
import { invalidarCacheReglas, VAR_ENTORNO } from './providers/allowlist';
import { calcularCosto } from './pricing/compute';
import { toolRegistry } from './tools/registry';

// ── Escenario ───────────────────────────────────────────────────────────────

const T_LUPITA = '11111111-1111-1111-1111-111111111111';
const T_CARLOS = '22222222-2222-2222-2222-222222222222';

const ctxDe = (tenantId: string, slug: string): TenantContext => ({
  tenantId,
  tenantSlug: slug,
  userEmail: `dueno@${slug}.mx`,
  role: 'owner',
  areas: { ventas: 'admin' },
});

const lupita = ctxDe(T_LUPITA, 'panaderia-lupita');
const carlos = ctxDe(T_CARLOS, 'taller-carlos');

/**
 * El catálogo de precios de las pruebas.
 *
 * Trae los modelos que estos casos usan de verdad, y a propósito NO trae
 * `claude-fable-5`: es el hueco con el que se prueba que un modelo conocido sin
 * precio ya no se corre a ciegas (ver «el precio, antes de gastar»).
 *
 * Antes sólo tenía Haiku. Eso pasaba porque nada revisaba que hubiera precio
 * para el modelo que la corrida iba a usar — el mismo agujero del hallazgo, en
 * miniatura y dentro de la propia suite.
 */
const PRECIOS: PricingRow[] = [
  {
    id: 'p-haiku',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    inputPerMtok: 1.0,
    outputPerMtok: 5.0,
    cacheWrite5mPerMtok: 1.25,
    cacheWrite1hPerMtok: 2.0,
    cacheReadPerMtok: 0.1,
    currency: 'USD',
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'p-sonnet-5',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    inputPerMtok: 2.0,
    outputPerMtok: 10.0,
    cacheWrite5mPerMtok: 2.5,
    cacheWrite1hPerMtok: 4.0,
    cacheReadPerMtok: 0.2,
    currency: 'USD',
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'p-opus-5',
    provider: 'anthropic',
    model: 'claude-opus-5',
    inputPerMtok: 5.0,
    outputPerMtok: 25.0,
    cacheWrite5mPerMtok: 6.25,
    cacheWrite1hPerMtok: 10.0,
    cacheReadPerMtok: 0.5,
    currency: 'USD',
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'p-or-haiku',
    provider: 'openrouter',
    model: 'anthropic/claude-haiku-4.5',
    inputPerMtok: 1.0,
    outputPerMtok: 5.0,
    cacheWrite5mPerMtok: 1.25,
    cacheWrite1hPerMtok: 2.0,
    cacheReadPerMtok: 0.1,
    currency: 'USD',
    effectiveFrom: '2026-01-01',
  },
];

function definicion(tenantId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `agente-${tenantId.slice(0, 4)}`,
    tenant_id: tenantId,
    role: 'sales',
    name: 'Ventas',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    key_ref: null,
    system_prompt: 'Eres el agente de ventas.',
    tools: [],
    enabled: true,
    ...extra,
  };
}

let db: FakeDb;
let restaurar: () => void;

function servicio(opts: { anthropicText?: string; openrouterText?: string; usage?: ReturnType<typeof usage> } = {}) {
  // Sin `requestId`: el doble le pone uno único por llamada, como la API real.
  const anthropic = createFakeAdapter('anthropic', {
    text: opts.anthropicText ?? 'Abrimos de 9 a 7.',
    usage: opts.usage ?? usage({ inputTokens: 1000, outputTokens: 100 }),
  });
  const openrouter = createFakeAdapter('openrouter', {
    text: opts.openrouterText ?? 'Respuesta por OpenRouter.',
    usage: opts.usage ?? usage({ inputTokens: 1000, outputTokens: 100, providerCostUsd: 0.0015 }),
  });

  const svc = createAgentService({
    router: createProviderRouter({ overrides: { anthropic, openrouter } }),
    pricing: createStaticPricingCatalog(PRECIOS),
    resolverLlaveImpl: () => Promise.resolve('llave-de-prueba'),
  });

  return { svc, anthropic, openrouter };
}

beforeEach(() => {
  db = createFakeDb({
    tenants: [
      { id: T_LUPITA, slug: 'panaderia-lupita', name: 'Panadería Lupita', plan: 'free' },
      { id: T_CARLOS, slug: 'taller-carlos', name: 'Taller Carlos', plan: 'pro' },
    ],
    agent_plan_limits: [
      { plan: 'free', monthly_budget_usd: '5.00', requests_per_minute: 10, max_output_tokens: 4096 },
      { plan: 'pro', monthly_budget_usd: '100.00', requests_per_minute: 60, max_output_tokens: 8192 },
    ],
    agent_definitions: [],
    usage_ledger: [],
    agent_messages: [],
    agent_budget_overrides: [],
  });
  restaurar = __setClientForTests(db.client);
  invalidarCachePresupuesto();
  toolRegistry.clear();
});

afterEach(() => {
  restaurar();
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #1
// ════════════════════════════════════════════════════════════════════════════

describe('criterio #1 — un agente nuevo responde sin redeploy', () => {
  it('crear la fila y correrlo, en el mismo proceso y sin reiniciar nada', async () => {
    const { svc } = servicio();

    // Antes de la fila: no hay agente.
    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // Alta por el port, como lo hará H7 en el bautizo.
    const { agentId } = await svc.upsertDefinition(lupita, {
      role: 'sales',
      name: 'Chelo',
      systemPrompt: 'Eres Chelo, atiendes la panadería.',
    });
    expect(agentId).toBeTruthy();

    // Y contesta. Sin commit, sin deploy, sin readdirSync de ningún YAML.
    const r = await svc.run(lupita, { role: 'sales', input: '¿a qué hora abren?' });
    expect(r.text).toBe('Abrimos de 9 a 7.');
    expect(r.agentName).toBe('Chelo');
  });

  it('cambiar el modelo en la fila aplica en la siguiente respuesta', async () => {
    const { svc, anthropic } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);

    await svc.run(lupita, { role: 'sales', input: 'hola' });
    expect(anthropic.llamadas[0]?.model).toBe('claude-haiku-4-5');

    // Un UPDATE, no un deploy.
    await tenantDb(lupita)
      .from('agent_definitions')
      .update({ model: 'claude-sonnet-5' })
      .eq('role', 'sales');

    await svc.run(lupita, { role: 'sales', input: 'otra vez' });
    expect(anthropic.llamadas[1]?.model).toBe('claude-sonnet-5');
  });

  it('un agente apagado no contesta', async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA, { enabled: false })]);

    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #2
// ════════════════════════════════════════════════════════════════════════════

describe('criterio #2 — cambiar de proveedor es una fila', () => {
  it('de anthropic a openrouter, sin tocar código', async () => {
    const { svc, anthropic, openrouter } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);

    const a = await svc.run(lupita, { role: 'sales', input: 'hola' });
    expect(a.text).toBe('Abrimos de 9 a 7.');
    expect(anthropic.llamadas).toHaveLength(1);
    expect(openrouter.llamadas).toHaveLength(0);

    // LA LÍNEA QUE IMPORTA: un UPDATE a dos columnas.
    await tenantDb(lupita)
      .from('agent_definitions')
      .update({ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' })
      .eq('role', 'sales');

    const b = await svc.run(lupita, { role: 'sales', input: 'hola otra vez' });
    expect(b.text).toBe('Respuesta por OpenRouter.');
    expect(openrouter.llamadas).toHaveLength(1);
  });

  it("provider='local' falla con un mensaje que dice exactamente qué hacer", async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, { provider: 'local', model: 'llama-propio' }),
    ]);

    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toThrow(
      /'local' todavía no tiene adaptador/,
    );
  });

  it('el costo de OpenRouter es el REPORTADO, no el calculado', async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' }),
    ]);

    await svc.run(lupita, { role: 'sales', input: 'hola' });

    const fila = db.tabla('usage_ledger')[0];
    expect(fila?.cost_source).toBe('provider');
    expect(fila?.cost_usd).toBe(0.0015);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #3
// ════════════════════════════════════════════════════════════════════════════

describe('criterio #3 — cada llamada deja una fila con costo real', () => {
  it('escribe los tokens medidos y el costo calculado', async () => {
    const { svc } = servicio({
      usage: usage({
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        cacheReadTokens: 500_000,
        requestId: 'msg_reconciliable',
      }),
    });
    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);

    const r = await svc.run(lupita, { role: 'sales', input: 'hola' });

    const fila = db.tabla('usage_ledger')[0];
    expect(fila).toBeDefined();
    // Los tokens crudos quedan guardados: es lo que permite recalcular.
    expect(fila?.input_tokens).toBe(1_000_000);
    expect(fila?.output_tokens).toBe(200_000);
    expect(fila?.cache_read_tokens).toBe(500_000);
    // 1.00 + 1.00 + 0.05
    expect(fila?.cost_usd).toBeCloseTo(2.05, 6);
    expect(fila?.cost_source).toBe('priced');
    // La llave para cuadrar contra la consola de Anthropic (criterio #3, ±5%).
    expect(fila?.request_id).toBe('msg_reconciliable');
    expect(r.usage.costUsd).toBeCloseTo(2.05, 6);
  });

  it('registra el consumo AUNQUE la llamada falle: esos tokens ya se facturan', async () => {
    const roto = createFakeAdapter('anthropic');
    roto.complete = () =>
      Promise.reject(new PlatformError('PROVIDER_ERROR', 'el proveedor se cayó'));

    const svc = createAgentService({
      router: createProviderRouter({ overrides: { anthropic: roto } }),
      pricing: createStaticPricingCatalog(PRECIOS),
      resolverLlaveImpl: () => Promise.resolve('k'),
    });
    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);

    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toThrow();

    const fila = db.tabla('usage_ledger')[0];
    expect(fila?.status).toBe('error');
  });

  it('un reintento con el mismo request_id no cobra dos veces', async () => {
    const { svc } = servicio({
      usage: usage({ inputTokens: 1000, outputTokens: 10, requestId: 'msg_repetido' }),
    });
    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);

    await svc.run(lupita, { role: 'sales', input: 'hola' });
    await svc.run(lupita, { role: 'sales', input: 'hola' });

    // El índice único parcial (provider, request_id) hace su trabajo.
    expect(db.tabla('usage_ledger')).toHaveLength(1);
  });

  it('sin precio capturado: registra en 0 y lo MARCA, no inventa un número', async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA, { model: 'claude-modelo-nuevo' })]);

    await svc.run(lupita, { role: 'sales', input: 'hola' });

    const fila = db.tabla('usage_ledger')[0];
    expect(fila?.cost_source).toBe('unpriced');
    expect(fila?.cost_usd).toBe(0);
    // Los tokens SÍ quedaron: en cuanto se capture el precio, se recalcula.
    expect(fila?.input_tokens).toBe(1000);
  });

  it('guarda las iteraciones: un agente dándose de topes deja de ser invisible', async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);

    await svc.run(lupita, { role: 'sales', input: 'hola' });

    expect(db.tabla('usage_ledger')[0]?.iterations).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Hallazgo 2026-07-31 · el tope era CIEGO al consumo sin precio
// ════════════════════════════════════════════════════════════════════════════

describe('un modelo sin precio ya no apaga el tope', () => {
  it('el consumo sin precio SÍ cuenta contra el presupuesto, con piso conservador', async () => {
    // El escenario del hallazgo, en corto: modelo sin precio → cost_usd 0 →
    // gastoDesde() sumaba 0 → el tope de $5 nunca se disparaba, y un tenant de
    // plan free podía quemar cientos de dólares reales mientras
    // GET /agents/budget reportaba gastadoUsd = 0.
    //
    // Un millón de tokens de entrada y 200 mil de salida al piso de Fable 5
    // ($10/$50 por Mtok) son $20 — cuatro veces el tope del plan free.
    const { svc } = servicio({
      usage: usage({ inputTokens: 1_000_000, outputTokens: 200_000 }),
    });
    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, { model: 'claude-modelo-que-nadie-tabuló' }),
    ]);

    await svc.run(lupita, { role: 'sales', input: 'hola' });

    const fila = db.tabla('usage_ledger')[0];
    // El costo sigue siendo honesto: 0 y marcado. No se inventa un precio.
    expect(fila?.cost_source).toBe('unpriced');
    expect(fila?.cost_usd).toBe(0);
    // Pero contra el tope cuenta el piso. Antes aquí no había nada.
    expect(fila?.budgeted_usd).toBeCloseTo(20, 6);

    // Y la consecuencia que importa: la SIGUIENTE corrida se corta.
    invalidarCachePresupuesto();
    await expect(svc.run(lupita, { role: 'sales', input: 'otra' })).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });
  });

  it('GET /agents/budget deja de reportar 0 mientras se quema dinero', async () => {
    const { svc } = servicio({ usage: usage({ inputTokens: 100_000, outputTokens: 20_000 }) });
    db.sembrar('agent_definitions', [definicion(T_LUPITA, { model: 'modelo-sin-tabular' })]);

    await svc.run(lupita, { role: 'sales', input: 'hola' });
    invalidarCachePresupuesto();

    const estado = await estadoPresupuesto(lupita);

    // 100k × $10/Mtok + 20k × $50/Mtok = 1.00 + 1.00. Es el piso, y es lo que
    // de verdad va a cortar el servicio, así que el restante se calcula sobre él.
    expect(estado.computadoUsd).toBeCloseTo(2, 6);
    expect(estado.restanteUsd).toBeCloseTo(3, 6);

    // Y el número CONCILIABLE sigue siendo honesto: no hay factura por esos $2.
    // Que los dos difieran es justo la señal de que falta capturar un precio.
    expect(estado.gastadoUsd).toBe(0);
  });

  it('con todo priced los dos números coinciden: el piso no aparece', async () => {
    // El caso normal. Si divergieran aquí, el cliente vería un cobro inventado.
    const { svc } = servicio({ usage: usage({ inputTokens: 1_000_000, outputTokens: 100_000 }) });
    db.sembrar('agent_definitions', [definicion(T_CARLOS)]);

    await svc.run(carlos, { role: 'sales', input: 'hola' });
    invalidarCachePresupuesto();

    // Haiku: 1M × $1/Mtok + 100k × $5/Mtok = 1.00 + 0.50
    const estado = await estadoPresupuesto(carlos);
    expect(estado.gastadoUsd).toBeCloseTo(1.5, 6);
    expect(estado.computadoUsd).toBe(estado.gastadoUsd);
  });

  it("un modelo 'local' no factura tokens: su piso es 0 de verdad", async () => {
    // El piso protege del gasto que no vemos. Un runtime propio no genera
    // gasto, así que cobrarle un piso sería cortarle el servicio a un cliente
    // por dinero que nadie está pagando.
    expect(calcularCosto(usage({ inputTokens: 1_000_000 }), null, 'local').budgetedUsd).toBe(0);
    expect(calcularCosto(usage({ inputTokens: 1_000_000 }), null, 'anthropic').budgetedUsd).toBe(10);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Frontera de datos · a qué países puede salir una conversación
// ════════════════════════════════════════════════════════════════════════════

describe('la lista blanca de proveedores', () => {
  it('un modelo fuera de la lista NO se corre, NO llama al proveedor y NO deja fila', async () => {
    // El escenario del ledger de producción: corridas contra DeepSeek, que
    // procesa en China, sin que ningún agent_definition lo declarara. El único
    // insumo de la selección era `agent_definitions.model`, texto libre que
    // nadie validaba ni al escribir ni al elegir.
    const { svc, anthropic, openrouter } = servicio();
    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, { provider: 'openrouter', model: 'deepseek/deepseek-chat' }),
    ]);

    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    // Las tres aserciones que importan, y en este orden:
    // 1. falló con un error de validación explícito  (arriba)
    // 2. NO se llamó al proveedor — ni un token salió del proceso
    expect(anthropic.llamadas).toHaveLength(0);
    expect(openrouter.llamadas).toHaveLength(0);
    // 3. NO se escribió fila en el ledger: la puerta va ANTES del paso que lo
    //    escribe, no dentro del try que registra el consumo de lo que falló.
    expect(db.tabla('usage_ledger')).toHaveLength(0);
  });

  it('lo mismo con Google, y el error dice cómo abrirlo si de verdad se quiere', async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, { provider: 'openrouter', model: 'google/gemini-2.5-flash' }),
    ]);

    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toThrow(
      /AGENTS_MODELOS_PERMITIDOS/,
    );
    expect(db.tabla('usage_ledger')).toHaveLength(0);
  });

  it('Anthropic pasa, directo y por OpenRouter: la lista no rompe lo que sí vale', async () => {
    const { svc, anthropic, openrouter } = servicio();

    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);
    expect((await svc.run(lupita, { role: 'sales', input: 'hola' })).text).toBeTruthy();
    expect(anthropic.llamadas).toHaveLength(1);

    db.sembrar('agent_definitions', [
      definicion(T_CARLOS, { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' }),
    ]);
    expect((await svc.run(carlos, { role: 'sales', input: 'hola' })).text).toBeTruthy();
    expect(openrouter.llamadas).toHaveLength(1);
  });

  it('la variable de entorno abre un proveedor, y sólo mientras esté puesta', async () => {
    // Configurable a propósito: abrir Google mañana tiene que ser una decisión
    // explícita y visible en el despliegue, no un descuido — y quitarla vuelve
    // a cerrar la puerta sin tocar código.
    const { svc, openrouter } = servicio();
    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, { provider: 'openrouter', model: 'google/gemini-2.5-flash' }),
    ]);

    process.env[VAR_ENTORNO] = 'anthropic:*,openrouter:google/*';
    invalidarCacheReglas();
    try {
      expect((await svc.run(lupita, { role: 'sales', input: 'hola' })).text).toBeTruthy();
      expect(openrouter.llamadas).toHaveLength(1);
    } finally {
      delete process.env[VAR_ENTORNO];
      invalidarCacheReglas();
    }

    await expect(svc.run(lupita, { role: 'sales', input: 'otra' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('tampoco se puede GUARDAR una definición fuera de la lista', async () => {
    // Defensa en profundidad: la puerta que protege es la de service.ts, pero
    // dejar escribir la fila deja al agente de ese rol muerto hasta que alguien
    // lea el log.
    const { svc } = servicio();

    await expect(
      svc.upsertDefinition(lupita, {
        role: 'analyst',
        name: 'Analista',
        systemPrompt: 'p',
        provider: 'openrouter',
        model: 'deepseek/deepseek-chat',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('el precio, antes de gastar', () => {
  it('un modelo del catálogo SIN precio se rechaza sin llamar al proveedor', async () => {
    // `claude-fable-5` está en capabilities.ts y no está en PRECIOS. Ése es el
    // estado exacto en que vivía `claude-sonnet-4-6` contra la base de
    // producción: un modelo que decimos conocer, factura de verdad, y sin fila
    // de precio. Antes la corrida pasaba y el gasto desaparecía; ahora se dice
    // a la primera y no se quema un token.
    const { svc, anthropic } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA, { model: 'claude-fable-5' })]);

    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(anthropic.llamadas).toHaveLength(0);
  });

  it('el error nombra la fila que falta, no dice "algo salió mal"', async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA, { model: 'claude-fable-5' })]);

    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toThrow(
      /claude-fable-5.*model_pricing|model_pricing.*claude-fable-5/s,
    );
  });

  it('un modelo DESCONOCIDO sí corre: estrenar modelo sin deploy es la promesa de H3', async () => {
    // La puerta es para lo que decimos conocer. Bloquear también lo desconocido
    // devolvería a H3 al YAML de disco de GARDEN. El dinero de ese caso lo
    // cubre el piso, no esta puerta.
    const { svc, anthropic } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA, { model: 'claude-opus-6' })]);

    const r = await svc.run(lupita, { role: 'sales', input: 'hola' });
    expect(r.text).toBeTruthy();
    expect(anthropic.llamadas).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Hallazgo 2026-07-31 · un error a media corrida borraba TODO el consumo
// ════════════════════════════════════════════════════════════════════════════

describe('un fallo del proveedor a media corrida no borra lo ya gastado', () => {
  function adaptadorQueRevientaEnLaSegunda() {
    const a = createFakeAdapter('anthropic', [
      {
        text: '',
        toolCalls: [{ id: 'tc-1', name: 'buscar', input: {} }],
        stopReason: 'tool_use',
        usage: usage({ inputTokens: 120_000, outputTokens: 8_000, requestId: 'msg_vuelta_1' }),
      },
    ]);
    const original = a.complete.bind(a);
    let n = 0;
    a.complete = (req) => {
      n += 1;
      if (n >= 2) {
        // Lo que Anthropic devuelve en un 529 overloaded: reintentable, y por
        // eso mismo peligroso — si H6 reintenta con el ledger en ceros, el
        // tenant quema decenas de dólares con el presupuesto sin enterarse.
        return Promise.reject(
          new PlatformError('PROVIDER_ERROR', 'Anthropic respondió 529: overloaded', {
            retryable: true,
          }),
        );
      }
      return original(req);
    };
    return a;
  }

  function servicioQueRevienta() {
    const a = adaptadorQueRevientaEnLaSegunda();
    const svc = createAgentService({
      router: createProviderRouter({ overrides: { anthropic: a } }),
      pricing: createStaticPricingCatalog(PRECIOS),
      resolverLlaveImpl: () => Promise.resolve('k'),
    });
    svc.registerTool({
      name: 'buscar',
      description: 'busca algo',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ ok: true }),
    });
    return { svc, a };
  }

  it('los tokens de la iteración que SÍ ocurrió llegan al ledger', async () => {
    const { svc } = servicioQueRevienta();
    db.sembrar('agent_definitions', [definicion(T_LUPITA, { tools: ['buscar'] })]);

    await expect(svc.run(lupita, { role: 'sales', input: 'usa la tool' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });

    const fila = db.tabla('usage_ledger')[0];
    expect(fila).toBeDefined();
    expect(fila?.status).toBe('error');
    // Ésta es la línea del hallazgo: antes eran ceros, y ~$0.32 de tokens ya
    // facturables desaparecían del tope.
    expect(fila?.input_tokens).toBe(120_000);
    expect(fila?.output_tokens).toBe(8_000);
    // 120k × $1/Mtok + 8k × $5/Mtok = 0.12 + 0.04
    expect(Number(fila?.cost_usd)).toBeCloseTo(0.16, 6);
    expect(fila?.cost_source).toBe('priced');

    // Y las iteraciones también se rescatan. Una fila con 120,000 tokens e
    // iterations=0 es internamente incoherente, y apaga justo la columna que la
    // migración 023 declara como el mecanismo para ver a un agente dándose de
    // topes: uno que revienta en la vuelta 9 se vería idéntico a uno que
    // revienta en la 1.
    expect(fila?.iterations).toBe(1);
  });

  it('y ese gasto cuenta contra el tope, que es de lo que se trataba', async () => {
    const { svc } = servicioQueRevienta();
    db.sembrar('agent_definitions', [definicion(T_LUPITA, { tools: ['buscar'] })]);

    await expect(svc.run(lupita, { role: 'sales', input: 'usa la tool' })).rejects.toThrow();
    invalidarCachePresupuesto();

    expect((await estadoPresupuesto(lupita)).gastadoUsd).toBeCloseTo(0.16, 6);
  });

  it('el PlatformError sube INTACTO: H6 sigue pudiendo decidir si reintenta', async () => {
    // El rescate del consumo no puede costar la clasificación del error. Si
    // aquí llegara un error envuelto, H6 dejaría de distinguir un 529
    // reintentable de un 400 que no se arregla solo.
    const { svc } = servicioQueRevienta();
    db.sembrar('agent_definitions', [definicion(T_LUPITA, { tools: ['buscar'] })]);

    try {
      await svc.run(lupita, { role: 'sales', input: 'usa la tool' });
      expect.unreachable('debió lanzar');
    } catch (e) {
      const err = e as PlatformError;
      expect(err).toBeInstanceOf(PlatformError);
      expect(err.code).toBe('PROVIDER_ERROR');
      expect(err.retryable).toBe(true);
      expect(err.message).toContain('529');
    }
  });

  it('cuando falla la PRIMERA llamada el consumo sí es cero, y se registra igual', async () => {
    // El caso que la suite ya cubría. Se conserva porque delimita el anterior:
    // el rescate no puede inventar tokens que nunca se midieron.
    const roto = createFakeAdapter('anthropic');
    roto.complete = () => Promise.reject(new PlatformError('PROVIDER_ERROR', 'se cayó'));

    const svc = createAgentService({
      router: createProviderRouter({ overrides: { anthropic: roto } }),
      pricing: createStaticPricingCatalog(PRECIOS),
      resolverLlaveImpl: () => Promise.resolve('k'),
    });
    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);

    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toThrow();

    const fila = db.tabla('usage_ledger')[0];
    expect(fila?.input_tokens).toBe(0);
    expect(fila?.status).toBe('error');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #5
// ════════════════════════════════════════════════════════════════════════════

describe('criterio #5 — al rebasar el presupuesto lanza, no degrada', () => {
  it('lanza BUDGET_EXCEEDED y NO llama al proveedor', async () => {
    const { svc, anthropic } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);
    // El plan free son $5. Ya lleva $6.
    db.sembrar('usage_ledger', [
      {
        id: '900',
        tenant_id: T_LUPITA,
        cost_usd: '6.00',
        created_at: new Date().toISOString(),
        agent_role: 'sales',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
      },
    ]);
    invalidarCachePresupuesto();

    await expect(svc.run(lupita, { role: 'sales', input: 'hola' })).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
      status: 402,
    });

    // Lo que de verdad importa: no se gastó un solo token más.
    expect(anthropic.llamadas).toHaveLength(0);
  });

  it('el error dice cuánto, de cuánto, y de dónde salió el límite', async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [definicion(T_LUPITA)]);
    db.sembrar('usage_ledger', [
      { id: '900', tenant_id: T_LUPITA, cost_usd: '6.00', created_at: new Date().toISOString() },
    ]);
    invalidarCachePresupuesto();

    try {
      await svc.run(lupita, { role: 'sales', input: 'hola' });
      expect.unreachable('debió lanzar');
    } catch (e) {
      const err = e as PlatformError;
      expect(err.message).toContain('$6.00');
      expect(err.message).toContain('$5.00');
      expect(err.message).toContain('free');
      // Y dice explícitamente que NO degradó, para que nadie lo confunda con
      // una respuesta mala del modelo.
      expect(err.message).toContain('No se degrada');
    }
  });

  it('el plan pro con más presupuesto sí pasa: el límite es del plan, no global', async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [definicion(T_CARLOS)]);
    db.sembrar('usage_ledger', [
      { id: '900', tenant_id: T_CARLOS, cost_usd: '6.00', created_at: new Date().toISOString() },
    ]);
    invalidarCachePresupuesto();

    // $6 de $100. Pasa.
    const r = await svc.run(carlos, { role: 'sales', input: 'hola' });
    expect(r.text).toBeTruthy();
  });

  it('un override por cliente gana sobre el plan', async () => {
    const { svc, anthropic } = servicio();
    db.sembrar('agent_definitions', [definicion(T_CARLOS)]);
    db.sembrar('agent_budget_overrides', [
      { tenant_id: T_CARLOS, monthly_budget_usd: '1.00', requests_per_minute: 60, note: 'prueba' },
    ]);
    db.sembrar('usage_ledger', [
      { id: '900', tenant_id: T_CARLOS, cost_usd: '2.00', created_at: new Date().toISOString() },
    ]);
    invalidarCachePresupuesto();

    // El plan pro daría $100, pero el override lo baja a $1 y ya lleva $2.
    await expect(svc.run(carlos, { role: 'sales', input: 'hola' })).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });
    expect(anthropic.llamadas).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #6
// ════════════════════════════════════════════════════════════════════════════

describe('criterio #6 — dos tenants, el mismo rol, agentes independientes', () => {
  it('prompt, modelo y nombre son distintos por cliente', async () => {
    const { svc, anthropic } = servicio();
    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, {
        id: 'a-lupita',
        name: 'Chelo',
        model: 'claude-haiku-4-5',
        system_prompt: 'Vendes pan dulce.',
      }),
      definicion(T_CARLOS, {
        id: 'a-carlos',
        name: 'Beto',
        model: 'claude-sonnet-5',
        system_prompt: 'Vendes servicio automotriz.',
      }),
    ]);

    const a = await svc.run(lupita, { role: 'sales', input: 'hola' });
    const b = await svc.run(carlos, { role: 'sales', input: 'hola' });

    expect(a.agentName).toBe('Chelo');
    expect(b.agentName).toBe('Beto');

    expect(anthropic.llamadas[0]?.model).toBe('claude-haiku-4-5');
    expect(anthropic.llamadas[1]?.model).toBe('claude-sonnet-5');
    expect(anthropic.llamadas[0]?.system).toContain('pan dulce');
    expect(anthropic.llamadas[1]?.system).toContain('automotriz');
    // Y ninguno ve el prompt del otro.
    expect(anthropic.llamadas[0]?.system).not.toContain('automotriz');
  });

  it('el consumo se contabiliza por separado', async () => {
    const { svc } = servicio();
    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, { id: 'a-lupita' }),
      definicion(T_CARLOS, { id: 'a-carlos' }),
    ]);

    await svc.run(lupita, { role: 'sales', input: 'hola' });
    await svc.run(carlos, { role: 'sales', input: 'hola' });
    await svc.run(carlos, { role: 'sales', input: 'otra' });

    const delLedger = db.tabla('usage_ledger');
    expect(delLedger.filter((f) => f.tenant_id === T_LUPITA)).toHaveLength(1);
    expect(delLedger.filter((f) => f.tenant_id === T_CARLOS)).toHaveLength(2);
  });

  it('el historial de un hilo no se cruza entre clientes', async () => {
    const { svc, anthropic } = servicio();
    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, { id: 'a-lupita' }),
      definicion(T_CARLOS, { id: 'a-carlos' }),
    ]);

    // Mismo threadId a propósito: si el aislamiento fallara, se verían.
    await svc.run(lupita, { role: 'sales', input: 'quiero conchas', threadId: 'hilo-1' });
    await svc.run(carlos, { role: 'sales', input: 'traigo el coche', threadId: 'hilo-1' });

    const sistemaDeCarlos = anthropic.llamadas[1];
    const textos = sistemaDeCarlos?.messages.map((m) => ('content' in m ? m.content : '')) ?? [];
    expect(textos.join(' ')).not.toContain('conchas');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #7
// ════════════════════════════════════════════════════════════════════════════

describe('criterio #7 — una tool del tenant A no puede leer datos del B', () => {
  it('el handler corre con el contexto de quien lo invocó, y sólo ve lo suyo', async () => {
    const vistos: Array<{ tenant: string; filas: number }> = [];

    // Una tool que intenta leer TODO el ledger. Con `tenantDb(ctx)` sólo puede
    // ver lo de su propio tenant, porque el filtro no se puede omitir.
    const espia: AgentTool = {
      name: 'leer_consumo',
      description: 'Intenta leer el ledger',
      inputSchema: { type: 'object', properties: {} },
      handler: async (ctx) => {
        const { data } = await tenantDb(ctx).from('usage_ledger').select('*');
        const filas = (data as unknown[] | null) ?? [];
        vistos.push({ tenant: ctx.tenantId, filas: filas.length });
        return { filas: filas.length };
      },
    };

    db.sembrar('agent_definitions', [
      definicion(T_LUPITA, { id: 'a-lupita', tools: ['leer_consumo'] }),
      definicion(T_CARLOS, { id: 'a-carlos', tools: ['leer_consumo'] }),
    ]);
    // Tres filas de Carlos, ninguna de Lupita.
    db.sembrar('usage_ledger', [
      { id: '1', tenant_id: T_CARLOS, cost_usd: '0.01', created_at: '2020-01-01T00:00:00Z' },
      { id: '2', tenant_id: T_CARLOS, cost_usd: '0.01', created_at: '2020-01-01T00:00:00Z' },
      { id: '3', tenant_id: T_CARLOS, cost_usd: '0.01', created_at: '2020-01-01T00:00:00Z' },
    ]);
    invalidarCachePresupuesto();

    const conTool = createFakeAdapter('anthropic', [
      {
        text: '',
        toolCalls: [{ id: 'tc-1', name: 'leer_consumo', input: {} }],
        stopReason: 'tool_use',
        usage: usage({ inputTokens: 10, outputTokens: 5 }),
      },
      { text: 'listo', usage: usage({ inputTokens: 10, outputTokens: 5 }) },
    ]);

    const svc = createAgentService({
      router: createProviderRouter({ overrides: { anthropic: conTool } }),
      pricing: createStaticPricingCatalog(PRECIOS),
      resolverLlaveImpl: () => Promise.resolve('k'),
    });
    svc.registerTool(espia);

    await svc.run(lupita, { role: 'sales', input: 'dame el consumo' });

    // LA ASERCIÓN: la tool corrió con el contexto de Lupita y vio CERO filas,
    // aunque en la tabla había tres — todas de Carlos.
    expect(vistos).toHaveLength(1);
    expect(vistos[0]?.tenant).toBe(T_LUPITA);
    expect(vistos[0]?.filas).toBe(0);
  });

  it('una tool que falla no tumba la corrida: el modelo recibe el error', async () => {
    const explota: AgentTool = {
      name: 'explota',
      description: 'Siempre falla',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.reject(new Error('se rompió')),
    };

    db.sembrar('agent_definitions', [definicion(T_LUPITA, { tools: ['explota'] })]);

    const conTool = createFakeAdapter('anthropic', [
      {
        text: '',
        toolCalls: [{ id: 'tc-1', name: 'explota', input: {} }],
        stopReason: 'tool_use',
        usage: usage({ inputTokens: 10, outputTokens: 5 }),
      },
      { text: 'no pude, pero aquí sigo', usage: usage({ inputTokens: 10, outputTokens: 5 }) },
    ]);

    const svc = createAgentService({
      router: createProviderRouter({ overrides: { anthropic: conTool } }),
      pricing: createStaticPricingCatalog(PRECIOS),
      resolverLlaveImpl: () => Promise.resolve('k'),
    });
    svc.registerTool(explota);

    const r = await svc.run(lupita, { role: 'sales', input: 'usa la tool' });
    expect(r.text).toBe('no pude, pero aquí sigo');

    // El error viajó al modelo como resultado de la tool, no como excepción.
    const turnoDeTool = conTool.llamadas[1]?.messages.find((m) => m.role === 'tool');
    expect(turnoDeTool && 'content' in turnoDeTool ? turnoDeTool.content : '').toContain('se rompió');
  });
});
