/**
 * Base de datos en memoria con la forma de PostgREST.
 *
 * Existe para que los criterios observables de H9 se puedan verificar sin una
 * base viva — que es también como corre CI, donde no hay `.env`.
 *
 * ── Lo importante: NO reimplementa el aislamiento ───────────────────────────
 *
 * El `.eq('tenant_id', …)` que separa a un cliente de otro lo pone
 * `tenantDb(ctx)` de H1, y este doble se limita a respetarlo como lo haría
 * Postgres. Por eso el criterio 6 (*"un tenant no ve tareas de otro"*) se prueba
 * de verdad aquí: si alguien rompiera `tenantDb`, la prueba se cae.
 *
 * ── Lo que SÍ reimplementa, y por qué se puede confiar ──────────────────────
 *
 * Las dos funciones transaccionales de la 070 (`reorder_tasks` y
 * `complete_task_cascade`) están reproducidas abajo. No son la implementación
 * de verdad: la de verdad es plpgsql, con `FOR UPDATE` y con la transacción que
 * revierte. Lo que se prueba con ellas es el CONTRATO —qué error levanta cada
 * caso y qué queda escrito—, que es lo que los servicios traducen a HTTP.
 *
 * Se instala con `__setClientForTests()`, el gancho que H1 dejó justo para esto.
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

/** Los defaults de la 070, para que una fila insertada por el doble tenga la
 *  misma forma que una insertada por Postgres. Sin esto, `parent_id` sería
 *  `undefined` en vez de `null` y el guard de subtareas no se dispararía. */
const DEFAULTS: Record<string, Fila> = {
  tasks: {
    project_id: null,
    parent_id: null,
    description: null,
    status: 'pending',
    priority: 'media',
    assigned_to: null,
    assigned_by: null,
    start_date: null,
    due_date: null,
    estimate_hours: null,
    tags: [],
    sort_order: 0,
    completed_at: null,
  },
  projects: {
    description: null,
    goal: null,
    status: 'active',
    icon: null,
    start_date: null,
    target_date: null,
    position: 0,
    created_by: null,
  },
  task_views: { config: {}, shared: false, position: 0 },
  task_comments: { author: null },
  task_events: { actor: null, from_value: null, to_value: null },
};

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

  /** Un `.select()` encadenado después de un insert o un update pide las filas
   *  escritas de vuelta; no cambia la operación. */
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
   * Postgres manda datos por un socket; devolver la referencia viva haría que
   * un `UPDATE` mutara por debajo el objeto que el llamador leyó ANTES —y una
   * prueba del historial ("¿cambió el estado?") compararía un objeto consigo
   * mismo y no vería ningún cambio nunca.
   */
  private empaquetar(crudas: Fila[]): Resultado {
    const filas = crudas.map((f) => ({ ...f }));
    if (this.unaSola === 'single') {
      const uno = filas[0];
      if (!uno) {
        return { data: null, error: { message: 'no rows returned', code: 'PGRST116' }, count: 0 };
      }
      return { data: uno, error: null, count: 1 };
    }
    if (this.unaSola === 'maybe') return { data: filas[0] ?? null, error: null, count: filas.length };
    return { data: filas, error: null, count: filas.length };
  }

  private ejecutar(): Resultado {
    const coincidentes = (): Fila[] => this.filas.filter((f) => this.filtros.every((x) => cumple(f, x)));

    if (this.accion === 'insert') {
      const escritas: Fila[] = [];
      for (const fila of this.payload) {
        const ahora = new Date().toISOString();
        const nueva: Fila = {
          id: this.siguienteId(),
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
// Las dos funciones de la 070, reproducidas
// ════════════════════════════════════════════════════════════════════════════

const ABIERTOS = ['pending', 'in_progress', 'blocked'];

interface RpcResultado {
  data: unknown;
  error: { message: string; code?: string } | null;
}

function rpcReorder(tablas: Map<string, Fila[]>, args: Fila): RpcResultado {
  const tenant = args.p_tenant;
  const items = Array.isArray(args.p_items) ? (args.p_items as Fila[]) : [];
  const tareas = tablas.get('tasks') ?? [];
  const eventos = tablas.get('task_events') ?? [];

  // Se calcula TODO antes de escribir nada: es lo que reproduce el "o todo o
  // nada" de la transacción.
  const cambios: Array<{ fila: Fila; item: Fila; antes: string }> = [];

  for (const item of items) {
    const fila = tareas.find((t) => t.id === item.id && t.tenant_id === tenant);
    if (!fila) return { data: null, error: { message: `task_not_found:${String(item.id)}`, code: 'P0002' } };

    const nuevo = item.status as string | undefined;
    const antes = String(fila.status);

    if (nuevo === 'completed' && antes !== 'completed' && fila.parent_id == null) {
      const abiertas = tareas.filter(
        (t) => t.parent_id === fila.id && t.tenant_id === tenant && ABIERTOS.includes(String(t.status)),
      );
      if (abiertas.length > 0) {
        return {
          data: null,
          error: { message: `open_subtasks:${abiertas.map((t) => String(t.id)).join(',')}`, code: 'P0001' },
        };
      }
    }
    cambios.push({ fila, item, antes });
  }

  for (const { fila, item, antes } of cambios) {
    fila.sort_order = item.sort_order;
    if (item.status != null) fila.status = item.status;
    if (item.priority != null) fila.priority = item.priority;
    if ('assigned_to' in item) fila.assigned_to = item.assigned_to;
    if ('project_id' in item) fila.project_id = item.project_id;
    if (item.status != null && item.status !== antes) {
      fila.completed_at = item.status === 'completed' ? new Date().toISOString() : null;
      eventos.push({
        id: `ev-${eventos.length + 1}`,
        tenant_id: tenant,
        task_id: fila.id,
        actor: item.actor ?? null,
        field: 'status',
        from_value: antes,
        to_value: item.status,
        created_at: new Date().toISOString(),
      });
    }
  }
  tablas.set('task_events', eventos);
  return { data: cambios.length, error: null };
}

function rpcCompleteCascade(tablas: Map<string, Fila[]>, args: Fila): RpcResultado {
  const tenant = args.p_tenant;
  const tareas = tablas.get('tasks') ?? [];
  const eventos = tablas.get('task_events') ?? [];

  const padre = tareas.find((t) => t.id === args.p_task && t.tenant_id === tenant);
  if (!padre) return { data: null, error: { message: `task_not_found:${String(args.p_task)}`, code: 'P0002' } };

  const anotar = (fila: Fila, antes: string): void => {
    eventos.push({
      id: `ev-${eventos.length + 1}`,
      tenant_id: tenant,
      task_id: fila.id,
      actor: args.p_actor ?? null,
      field: 'status',
      from_value: antes,
      to_value: 'completed',
      created_at: new Date().toISOString(),
    });
  };

  let n = 0;
  if (padre.parent_id == null) {
    for (const sub of tareas.filter(
      (t) => t.parent_id === padre.id && t.tenant_id === tenant && ABIERTOS.includes(String(t.status)),
    )) {
      anotar(sub, String(sub.status));
      sub.status = 'completed';
      sub.completed_at = new Date().toISOString();
      n += 1;
    }
  }
  if (padre.status !== 'completed') {
    anotar(padre, String(padre.status));
    padre.status = 'completed';
    padre.completed_at = new Date().toISOString();
    n += 1;
  }

  tablas.set('task_events', eventos);
  return { data: n, error: null };
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
  for (const [k, v] of Object.entries(datos)) tablas.set(k, v.map((f) => ({ ...f })));

  let n = 0;
  const siguienteId = (): string => {
    n += 1;
    return `fake-${n}`;
  };

  const client = {
    from: (tabla: string) => new Builder(tablas, tabla, siguienteId),
    rpc: (fn: string, args: Fila) => {
      if (fn === 'reorder_tasks') return Promise.resolve(rpcReorder(tablas, args));
      if (fn === 'complete_task_cascade') return Promise.resolve(rpcCompleteCascade(tablas, args));
      return Promise.resolve({ data: null, error: { message: `función desconocida: ${fn}` } });
    },
  };

  return {
    tabla: (nombre) => tablas.get(nombre) ?? [],
    sembrar: (nombre, filas) => {
      tablas.set(
        nombre,
        filas.map((f) => ({ ...f })),
      );
    },
    reset: () => {
      tablas.clear();
      n = 0;
    },
    client: client as unknown as AnyClient,
  };
}
