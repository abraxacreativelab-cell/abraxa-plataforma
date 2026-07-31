/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Base en memoria con la forma de PostgREST.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Misma idea que la de H15 (`packages/crm/src/testing/fake-db.ts`), escrita
 *  aquí porque aquel paquete no la exporta y porque los índices que hay que
 *  reproducir son OTROS: los de las migraciones 060 y 061.
 *
 *  Las dos reglas que la hacen valer, y no ser un adorno:
 *
 *  1. **NO reimplementa el aislamiento por tenant.** El `.eq('tenant_id', …)`
 *     lo pone `tenantDb(ctx)` de H1; esto sólo lo respeta como lo haría
 *     Postgres. Por eso la prueba «un flujo del tenant A no toca datos del B»
 *     significa algo: si alguien rompiera `tenantDb`, se cae.
 *
 *  2. **SÍ reimplementa los índices únicos**, uno por uno y con la misma
 *     cláusula `WHERE` parcial. Sin ellos, «reintentar no manda dos mensajes»
 *     sería teatro: pasaría igual con el código roto, porque nada rechazaría
 *     el segundo INSERT. Ese rechazo ES lo que se está probando.
 */
import type { AnyClient, MembershipRole, TenantContext } from '@abraxa/db';

export type Fila = Record<string, unknown>;

interface Resultado {
  data: Fila[] | Fila | null;
  error: { message: string; code?: string } | null;
  count: number | null;
}

interface Unico {
  cols: string[];
  /** Reproduce el `WHERE` de los índices PARCIALES. */
  donde?: (f: Fila) => boolean;
}

/** Los índices únicos de 060 y 061, tal cual. */
const UNICOS: Record<string, Unico[]> = {
  flows: [],
  flow_versions: [{ cols: ['tenant_id', 'flow_id', 'version'] }],
  flow_runs: [
    {
      // flow_runs_viva_idx: un contacto no corre dos veces el mismo flujo a la
      // vez. Las de prueba quedan FUERA, como en la migración.
      cols: ['tenant_id', 'flow_id', 'contact_id'],
      donde: (f) =>
        f.contact_id !== null &&
        f.contact_id !== undefined &&
        f.is_test !== true &&
        ['running', 'waiting', 'paused'].includes(String(f.status)),
    },
  ],
  flow_steps: [
    {
      // flow_steps_hecho_idx: un nodo se completa CON ÉXITO una sola vez.
      cols: ['tenant_id', 'run_id', 'node_id'],
      donde: (f) => f.status === 'ok',
    },
  ],
};

type Op = 'eq' | 'neq' | 'in' | 'is' | 'lt' | 'gt' | 'gte' | 'lte';

interface Filtro {
  col: string;
  op: Op;
  valor: unknown;
}

function cumple(fila: Fila, f: Filtro): boolean {
  const v = fila[f.col];
  switch (f.op) {
    case 'eq':
      return v === f.valor;
    case 'neq':
      return v !== f.valor;
    case 'is':
      return f.valor === null ? v === null || v === undefined : v === f.valor;
    case 'in':
      return Array.isArray(f.valor) && f.valor.includes(v);
    default: {
      if (v === null || v === undefined) return false;
      const a = String(v);
      const b = String(f.valor);
      if (f.op === 'lt') return a < b;
      if (f.op === 'gt') return a > b;
      if (f.op === 'gte') return a >= b;
      return a <= b;
    }
  }
}

class Builder implements PromiseLike<Resultado> {
  private filtros: Filtro[] = [];
  private orden: { col: string; asc: boolean } | null = null;
  private tope: number | null = null;
  private conConteo = false;
  private soloConteo = false;
  private unaSola = false;
  private accion: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Fila[] = [];
  private conflicto: string[] = [];
  private devolverAfectadas = false;

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

  select(_cols?: string, opts?: { head?: boolean; count?: string }): this {
    if (this.accion !== 'select') {
      this.devolverAfectadas = true;
      return this;
    }
    if (opts?.count) this.conConteo = true;
    if (opts?.head) this.soloConteo = true;
    return this;
  }

  insert(rows: Fila | Fila[]): this {
    this.accion = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows: Fila | Fila[], opts?: { onConflict?: string }): this {
    this.accion = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    if (opts?.onConflict) this.conflicto = opts.onConflict.split(',').map((s) => s.trim());
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
  is(col: string, valor: unknown): this {
    this.filtros.push({ col, op: 'is', valor });
    return this;
  }
  in(col: string, valores: unknown[]): this {
    this.filtros.push({ col, op: 'in', valor: valores });
    return this;
  }
  lt(col: string, v: unknown): this {
    this.filtros.push({ col, op: 'lt', valor: v });
    return this;
  }
  gt(col: string, v: unknown): this {
    this.filtros.push({ col, op: 'gt', valor: v });
    return this;
  }
  gte(col: string, v: unknown): this {
    this.filtros.push({ col, op: 'gte', valor: v });
    return this;
  }
  lte(col: string, v: unknown): this {
    this.filtros.push({ col, op: 'lte', valor: v });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orden = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number): this {
    this.tope = n;
    return this;
  }
  maybeSingle(): this {
    this.unaSola = true;
    this.tope = 1;
    return this;
  }
  single(): this {
    this.unaSola = true;
    this.tope = 1;
    return this;
  }

  /** ¿Rompe `candidata` algún índice único, ignorando `exceptoId`? */
  private choque(candidata: Fila, exceptoId?: unknown): boolean {
    for (const u of UNICOS[this.tabla] ?? []) {
      if (u.donde && !u.donde(candidata)) continue;
      const hay = this.filas.some((f) => {
        if (exceptoId !== undefined && f.id === exceptoId) return false;
        if (u.donde && !u.donde(f)) return false;
        return u.cols.every((c) => f[c] === candidata[c]);
      });
      if (hay) return true;
    }
    return false;
  }

  private ejecutar(): Resultado {
    const coincidentes = (): Fila[] => this.filas.filter((f) => this.filtros.every((x) => cumple(f, x)));

    const duplicado = (): Resultado => ({
      data: null,
      error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      count: null,
    });

    if (this.accion === 'insert' || this.accion === 'upsert') {
      const escritas: Fila[] = [];
      for (const fila of this.payload) {
        if (this.accion === 'upsert' && this.conflicto.length > 0) {
          const previa = this.filas.find((f) => this.conflicto.every((c) => f[c] === fila[c]));
          if (previa) {
            Object.assign(previa, fila);
            escritas.push(previa);
            continue;
          }
        }
        const nueva: Fila = {
          id: this.siguienteId(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...fila,
        };
        if (this.choque(nueva)) return duplicado();
        this.filas.push(nueva);
        escritas.push(nueva);
      }
      const salida = this.devolverAfectadas ? escritas : null;
      return {
        data: this.unaSola ? (escritas[0] ?? null) : salida,
        error: null,
        count: null,
      };
    }

    if (this.accion === 'update') {
      const patch = this.payload[0] ?? {};
      const objetivo = coincidentes();
      for (const f of objetivo) if (this.choque({ ...f, ...patch }, f.id)) return duplicado();
      for (const f of objetivo) Object.assign(f, patch);
      return { data: this.devolverAfectadas ? objetivo : null, error: null, count: objetivo.length };
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
    if (this.orden) {
      const { col, asc } = this.orden;
      filas = [...filas].sort((a, b) => {
        const x = a[col];
        const y = b[col];
        const xv = x === null || x === undefined;
        const yv = y === null || y === undefined;
        if (xv && yv) return 0;
        if (xv) return 1;
        if (yv) return -1;
        const sx = String(x);
        const sy = String(y);
        const nx = Number(sx);
        const ny = Number(sy);
        const cmp =
          Number.isFinite(nx) && Number.isFinite(ny) && sx.trim() !== '' && sy.trim() !== ''
            ? nx - ny
            : sx < sy
              ? -1
              : sx > sy
                ? 1
                : 0;
        return asc ? cmp : -cmp;
      });
    }

    const total = filas.length;
    if (this.soloConteo) return { data: null, error: null, count: total };
    if (this.tope !== null) filas = filas.slice(0, this.tope);
    if (this.unaSola) return { data: filas[0] ?? null, error: null, count: total };
    return { data: filas, error: null, count: this.conConteo ? total : null };
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

export interface FakeDb {
  tabla(nombre: string): Fila[];
  sembrar(nombre: string, filas: Fila[]): void;
  reset(): void;
  /** Se pasa a `__setClientForTests()`, el gancho que dejó H1. */
  client: AnyClient;
}

export function crearFakeDb(datos: Record<string, Fila[]> = {}): FakeDb {
  const tablas = new Map<string, Fila[]>();
  for (const [k, v] of Object.entries(datos)) tablas.set(k, v.map((f) => ({ ...f })));

  let n = 0;
  const siguienteId = (): string => {
    n += 1;
    return `id-${String(n).padStart(4, '0')}`;
  };

  const client = { from: (tabla: string) => new Builder(tablas, tabla, siguienteId) };

  return {
    tabla: (nombre) => tablas.get(nombre) ?? [],
    sembrar: (nombre, filas) => {
      tablas.set(nombre, filas.map((f) => ({ ...f })));
    },
    reset: () => {
      tablas.clear();
      n = 0;
    },
    client: client as unknown as AnyClient,
  };
}

/** Un `TenantContext` mínimo para las pruebas. */
export function contextoDePrueba(
  tenantId: string,
  extra: { role?: MembershipRole | null; email?: string | null } = {},
): TenantContext {
  return {
    tenantId,
    tenantSlug: tenantId,
    userEmail: extra.email === undefined ? 'santiago@abraxa.club' : extra.email,
    role: extra.role === undefined ? 'owner' : extra.role,
    areas: {},
  };
}
