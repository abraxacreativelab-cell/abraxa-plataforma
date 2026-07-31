/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Base de datos en memoria con la forma de PostgREST
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Existe para que los ocho criterios observables de H11 se puedan verificar sin
 *  una base viva — que es también como corre CI, donde no hay `.env`.
 *
 *  ── Lo importante: NO reimplementa el aislamiento ───────────────────────────
 *
 *  El `.eq('tenant_id', …)` que separa a un cliente de otro lo pone
 *  `tenantDb(ctx)` de H1, y este doble se limita a respetarlo como lo haría
 *  Postgres. Por eso la prueba de que un tenant no ve el mapa de otro es una
 *  prueba de verdad: si alguien rompiera `tenantDb`, se cae.
 *
 *  ── Lo que SÍ reproduce, y por qué se puede confiar ─────────────────────────
 *
 *  Las dos funciones de la 090 (`areas_signals` y `areas_seed_tenant`) están
 *  reproducidas abajo. No son la implementación de verdad —la de verdad es
 *  plpgsql, con sus `to_regclass` y su `ON CONFLICT`—: lo que se prueba con
 *  ellas es el CONTRATO. Qué devuelven, qué cuentan y qué NO pisan al
 *  resembrar, que es lo que los servicios traducen a estados del mapa.
 *
 *  Que el SQL de verdad haga lo mismo lo verifica `domain/catalog.test.ts`,
 *  leyendo la migración.
 *
 *  Se instala con `__setClientForTests()`, el gancho que H1 dejó justo para esto.
 */
import type { AnyClient } from '@abraxa/db';

export type Fila = Record<string, unknown>;

type Op = 'eq' | 'neq' | 'in' | 'is';
interface Filtro {
  col: string;
  op: Op;
  valor: unknown;
}

interface Resultado {
  data: Fila[] | Fila | null;
  error: { message: string; code?: string } | null;
  count: number | null;
}

/** Los defaults de la 090, para que una fila insertada por el doble tenga la
 *  misma forma que una insertada por Postgres. Sin esto `progress` sería
 *  `undefined` en vez de `{}` y el evaluador no vería las declaraciones. */
const DEFAULTS: Record<string, Fila> = {
  tenant_areas: {
    state: 'bloqueada',
    label: '',
    icon: 'wrench',
    blurb: '',
    tools: [],
    requirements: [],
    progress: {},
    unlocked_at: null,
    position: 0,
  },
  tenant_milestones: {
    area_slug: null,
    description: null,
    position: 0,
    done_at: null,
    generated_by: 'master_agent',
  },
  area_onboarding_runs: { step: 0, answers: [], result: null, completed_at: null },
};

/** Las tablas con llave compuesta, para que el doble no invente un `id`. */
const SIN_ID = new Set(['tenant_areas', 'area_onboarding_runs']);

function cumple(fila: Fila, f: Filtro): boolean {
  const v = fila[f.col];
  if (f.op === 'eq') return v === f.valor;
  if (f.op === 'neq') return v !== f.valor;
  if (f.op === 'is') return f.valor === null ? v == null : v === f.valor;
  return Array.isArray(f.valor) && f.valor.includes(v);
}

function comparar(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

class Builder implements PromiseLike<Resultado> {
  private filtros: Filtro[] = [];
  private ordenes: Array<{ col: string; asc: boolean }> = [];
  private tope: number | null = null;
  private unaSola: 'single' | 'maybe' | null = null;
  private accion: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Fila[] = [];
  private devolver = false;

  constructor(
    private readonly tablas: Map<string, Fila[]>,
    private readonly tabla: string,
    private readonly siguienteId: () => string,
  ) {}

  private get filas(): Fila[] {
    let f = this.tablas.get(this.tabla);
    if (!f) {
      f = [];
      this.tablas.set(this.tabla, f);
    }
    return f;
  }

  /** Un `.select()` encadenado después de un insert pide las filas escritas de
   *  vuelta; no cambia la operación. */
  select(_cols?: string, _opts?: unknown): this {
    this.devolver = true;
    return this;
  }

  insert(rows: Fila | Fila[]): this {
    this.accion = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Fila): this {
    this.accion = 'update';
    this.payload = [patch];
    return this;
  }

  delete(): this {
    this.accion = 'delete';
    return this;
  }

  eq(col: string, valor: unknown): this {
    this.filtros.push({ col, op: 'eq', valor });
    return this;
  }
  neq(col: string, valor: unknown): this {
    this.filtros.push({ col, op: 'neq', valor });
    return this;
  }
  in(col: string, valor: unknown[]): this {
    this.filtros.push({ col, op: 'in', valor });
    return this;
  }
  is(col: string, valor: unknown): this {
    this.filtros.push({ col, op: 'is', valor });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.ordenes.push({ col, asc: opts?.ascending !== false });
    return this;
  }

  limit(n: number): this {
    this.tope = n;
    return this;
  }

  single(): this {
    this.unaSola = 'single';
    return this;
  }

  maybeSingle(): this {
    this.unaSola = 'maybe';
    this.tope = this.tope ?? 1;
    return this;
  }

  /**
   * Se devuelven COPIAS, nunca las filas guardadas.
   *
   * Postgres manda datos por un socket; devolver la referencia viva haría que un
   * `UPDATE` mutara por debajo el objeto que el llamador leyó ANTES — y una
   * prueba de "¿cambió el estado?" compararía un objeto consigo mismo y no
   * vería nunca ningún cambio.
   */
  private empaquetar(crudas: Fila[]): Resultado {
    const filas = crudas.map((f) => structuredClone(f));
    if (this.unaSola === 'single') {
      const uno = filas[0];
      if (!uno) {
        return { data: null, error: { message: 'no rows returned', code: 'PGRST116' }, count: 0 };
      }
      return { data: uno, error: null, count: 1 };
    }
    if (this.unaSola === 'maybe') {
      return { data: filas[0] ?? null, error: null, count: filas.length };
    }
    return { data: filas, error: null, count: filas.length };
  }

  private ejecutar(): Resultado {
    const coincidentes = (): Fila[] =>
      this.filas.filter((f) => this.filtros.every((x) => cumple(f, x)));

    if (this.accion === 'insert') {
      const escritas: Fila[] = [];
      for (const fila of this.payload) {
        const ahora = new Date().toISOString();
        const nueva: Fila = {
          ...(SIN_ID.has(this.tabla) ? {} : { id: this.siguienteId() }),
          created_at: ahora,
          updated_at: ahora,
          ...(DEFAULTS[this.tabla] ?? {}),
          ...fila,
        };
        // Postgres ignora las claves ausentes; un `undefined` explícito de un
        // objeto de JS no es lo mismo que "no viene la columna".
        for (const [k, v] of Object.entries(nueva)) if (v === undefined) delete nueva[k];
        this.filas.push(nueva);
        escritas.push(nueva);
      }
      return this.empaquetar(this.devolver ? escritas : []);
    }

    if (this.accion === 'update') {
      const patch = this.payload[0] ?? {};
      const objetivo = coincidentes();
      for (const f of objetivo) {
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) f[k] = v;
        f.updated_at = new Date().toISOString();
      }
      return this.empaquetar(objetivo);
    }

    if (this.accion === 'delete') {
      const objetivo = new Set(coincidentes());
      this.tablas.set(
        this.tabla,
        this.filas.filter((f) => !objetivo.has(f)),
      );
      return { data: null, error: null, count: objetivo.size };
    }

    let filas = coincidentes();
    if (this.ordenes.length) {
      filas = [...filas].sort((a, b) => {
        for (const { col, asc } of this.ordenes) {
          const c = comparar(a[col], b[col]);
          if (c) return asc ? c : -c;
        }
        return 0;
      });
    }
    if (this.tope !== null) filas = filas.slice(0, this.tope);
    return this.empaquetar(filas);
  }

  then<R1 = Resultado, R2 = never>(
    alCumplir?: ((v: Resultado) => R1 | PromiseLike<R1>) | null,
    alFallar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    try {
      return Promise.resolve(this.ejecutar()).then(alCumplir, alFallar);
    } catch (e) {
      return Promise.reject(e).then(alCumplir, alFallar);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Las dos funciones de la 090, reproducidas
// ════════════════════════════════════════════════════════════════════════════

interface RpcResultado {
  data: unknown;
  error: { message: string; code?: string } | null;
}

const MES_MS = 2_592_000_000;

/** `app.areas_signals`. Las tablas que no existen valen cero, igual que hace el
 *  `to_regclass` del SQL de verdad. */
function rpcSignals(tablas: Map<string, Fila[]>, args: Fila): RpcResultado {
  const t = args.p_tenant;
  const de = (nombre: string): Fila[] => (tablas.get(nombre) ?? []).filter((f) => f.tenant_id === t);

  const tenant = (tablas.get('tenants') ?? []).find((f) => f.id === t);
  const creado = typeof tenant?.created_at === 'string' ? Date.parse(tenant.created_at) : NaN;
  const meses = Number.isFinite(creado) ? Math.floor((Date.now() - creado) / MES_MS) : 0;

  const etapas = de('pipeline_stages');
  const ganadas = new Set(etapas.filter((e) => e.is_won === true).map((e) => e.id));

  return {
    data: {
      channels_active: de('channels').filter((c) => c.status === 'active').length,
      pipeline_stages: etapas.length,
      values_active: de('canonical_values').filter((v) => v.active === true).length,
      documents: de('documents').length,
      contacts_active: de('contacts').filter((c) => c.lifecycle !== 'churned').length,
      deals_won: de('contact_stages').filter((c) => ganadas.has(c.stage_id)).length,
      months_operating: Math.max(0, meses),
    },
    error: null,
  };
}

/**
 * `app.areas_seed_tenant`. La unión de las áreas del giro (H4) con las del
 * catálogo marcadas `seed_always`, y el `ON CONFLICT` que NO pisa el avance.
 */
function rpcSeed(tablas: Map<string, Fila[]>, args: Fila): RpcResultado {
  const t = args.p_tenant;
  const tenant = (tablas.get('tenants') ?? []).find((f) => f.id === t);
  if (!tenant) return { data: null, error: { message: 'tenant no existe', code: 'no_data_found' } };

  const plantillas = tablas.get('industry_templates') ?? [];
  let giro = typeof tenant.industry_type === 'string' ? tenant.industry_type : 'general';
  if (!plantillas.some((p) => p.id === giro)) giro = 'general';

  const plantilla = plantillas.find((p) => p.id === giro);
  const delGiro = (Array.isArray(plantilla?.areas) ? plantilla.areas : []) as Fila[];

  // Precedencia: la fila del giro le gana a la de '*'.
  const catalogo = tablas.get('area_catalog') ?? [];
  const regla = new Map<string, Fila>();
  for (const c of catalogo.filter((c) => c.industry_id === '*')) regla.set(String(c.area_slug), c);
  for (const c of catalogo.filter((c) => c.industry_id === giro)) regla.set(String(c.area_slug), c);

  const objetivo: Fila[] = delGiro.map((a) => {
    const r = regla.get(String(a.slug));
    return {
      area_slug: String(a.slug),
      label: a.label ?? r?.label ?? String(a.slug),
      icon: r?.icon ?? a.icon ?? 'wrench',
      blurb: a.blurb ?? r?.blurb ?? '',
      position: a.position ?? r?.position ?? 0,
      requirements: r?.requirements ?? [],
      state: r?.initial_state ?? 'bloqueada',
      tools: r?.tools ?? [],
    };
  });

  const yaEsta = new Set(objetivo.map((o) => o.area_slug));
  for (const r of regla.values()) {
    if (r.seed_always === true && !yaEsta.has(String(r.area_slug))) {
      objetivo.push({
        area_slug: String(r.area_slug),
        label: r.label ?? String(r.area_slug),
        icon: r.icon ?? 'wrench',
        blurb: r.blurb ?? '',
        position: r.position ?? 50,
        requirements: r.requirements ?? [],
        state: r.initial_state ?? 'bloqueada',
        tools: r.tools ?? [],
      });
    }
  }

  const filas = tablas.get('tenant_areas') ?? [];
  tablas.set('tenant_areas', filas);
  let nuevas = 0;

  for (const o of objetivo) {
    const existente = filas.find((f) => f.tenant_id === t && f.area_slug === o.area_slug);
    if (existente) {
      // Del catálogo: se refresca. De lo demás: NADA.
      existente.label = o.label;
      existente.icon = o.icon;
      existente.blurb = o.blurb;
      existente.tools = o.tools;
      existente.position = o.position;
      continue;
    }
    filas.push({
      tenant_id: t,
      ...DEFAULTS.tenant_areas,
      ...o,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    nuevas += 1;
  }

  return { data: nuevas, error: null };
}

export interface FakeDb {
  /** Las filas de una tabla, para inspeccionarlas en una aserción. */
  tabla(nombre: string): Fila[];
  sembrar(nombre: string, filas: Fila[]): void;
  reset(): void;
  /** Se pasa a `__setClientForTests()`. */
  client: AnyClient;
}

export function createFakeDb(datos: Record<string, Fila[]> = {}): FakeDb {
  const tablas = new Map<string, Fila[]>();
  for (const [k, v] of Object.entries(datos)) tablas.set(k, v.map((f) => structuredClone(f)));

  let n = 0;
  const siguienteId = (): string => {
    n += 1;
    return `fake-${n}`;
  };

  const client = {
    from: (tabla: string) => new Builder(tablas, tabla, siguienteId),
    rpc: (fn: string, args: Fila) => {
      if (fn === 'areas_signals') return Promise.resolve(rpcSignals(tablas, args));
      if (fn === 'areas_seed_tenant') return Promise.resolve(rpcSeed(tablas, args));
      return Promise.resolve({ data: null, error: { message: `función desconocida: ${fn}` } });
    },
  };

  return {
    tabla: (nombre) => tablas.get(nombre) ?? [],
    sembrar: (nombre, filas) => {
      tablas.set(
        nombre,
        filas.map((f) => structuredClone(f)),
      );
    },
    reset: () => {
      tablas.clear();
      n = 0;
    },
    client: client as unknown as AnyClient,
  };
}
