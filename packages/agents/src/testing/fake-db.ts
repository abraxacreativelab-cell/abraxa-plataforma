/**
 * Base de datos en memoria con la forma de PostgREST.
 *
 * Existe para que los siete criterios observables de H3 se puedan verificar sin
 * una base viva — que es también como corre CI, donde no hay `.env`.
 *
 * Lo importante: **no reimplementa el aislamiento**. El `.eq('tenant_id', …)`
 * que separa a un cliente de otro lo pone `tenantDb(ctx)` de H1, y este doble
 * simplemente lo respeta como lo haría Postgres. Por eso el criterio #7
 * (una tool del tenant A no puede leer del B) se prueba de verdad aquí: si
 * alguien rompiera `tenantDb`, esta prueba se caería.
 *
 * Se instala con `__setClientForTests()`, el gancho que H1 dejó justo para esto.
 */
import type { AnyClient } from '@abraxa/db';

export type Fila = Record<string, unknown>;

interface Filtro {
  col: string;
  op: 'eq' | 'gte' | 'lte';
  valor: unknown;
}

interface Resultado {
  data: Fila[] | Fila | null;
  error: { message: string; code?: string } | null;
  count: number | null;
}

function cumple(fila: Fila, f: Filtro): boolean {
  const v = fila[f.col];
  if (f.op === 'eq') return v === f.valor;
  // gte/lte se usan sobre timestamps ISO, donde el orden lexicográfico coincide
  // con el cronológico. Es exactamente el caso del ledger.
  if (v === undefined || v === null) return false;
  const a = String(v);
  const b = String(f.valor);
  return f.op === 'gte' ? a >= b : a <= b;
}

class Builder implements PromiseLike<Resultado> {
  private filtros: Filtro[] = [];
  private orden: { col: string; asc: boolean } | null = null;
  private tope: number | null = null;
  private soloConteo = false;
  private unaSola = false;
  private accion: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Fila[] = [];
  private devolverInsertadas = false;

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
    if (this.accion === 'upsert' || this.accion === 'insert') {
      this.devolverInsertadas = true;
      return this;
    }
    this.accion = 'select';
    if (opts?.count) this.soloConteo = true;
    return this;
  }

  insert(rows: Fila | Fila[]): this {
    this.accion = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows: Fila | Fila[], _opts?: { onConflict?: string }): this {
    this.accion = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    if (_opts?.onConflict) this.conflicto = _opts.onConflict.split(',').map((s) => s.trim());
    return this;
  }

  private conflicto: string[] = [];

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

  gte(col: string, valor: unknown): this {
    this.filtros.push({ col, op: 'gte', valor });
    return this;
  }

  lte(col: string, valor: unknown): this {
    this.filtros.push({ col, op: 'lte', valor });
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

  private ejecutar(): Resultado {
    const coincidentes = (): Fila[] => this.filas.filter((f) => this.filtros.every((x) => cumple(f, x)));

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
        // Índice único parcial del ledger: (provider, request_id). Es lo que
        // hace que un reintento no cobre dos veces, y el doble tiene que
        // reproducirlo para que la prueba de idempotencia signifique algo.
        if (this.tabla === 'usage_ledger' && fila.request_id) {
          const dup = this.filas.some(
            (f) => f.provider === fila.provider && f.request_id === fila.request_id,
          );
          if (dup) {
            return {
              data: null,
              error: { message: 'duplicate key value violates unique constraint', code: '23505' },
              count: null,
            };
          }
        }
        const nueva: Fila = { id: this.siguienteId(), created_at: new Date().toISOString(), ...fila };
        this.filas.push(nueva);
        escritas.push(nueva);
      }
      return { data: this.devolverInsertadas ? escritas : null, error: null, count: null };
    }

    if (this.accion === 'update') {
      const patch = this.payload[0] ?? {};
      const objetivo = coincidentes();
      for (const f of objetivo) Object.assign(f, patch);
      return { data: objetivo, error: null, count: objetivo.length };
    }

    if (this.accion === 'delete') {
      const objetivo = new Set(coincidentes());
      const quedan = this.filas.filter((f) => !objetivo.has(f));
      this.tablas.set(this.tabla, quedan);
      return { data: null, error: null, count: objetivo.size };
    }

    // SELECT
    let filas = coincidentes();

    if (this.orden) {
      const { col, asc } = this.orden;
      filas = [...filas].sort((a, b) => {
        const x = String(a[col] ?? '');
        const y = String(b[col] ?? '');
        // Los ids del doble son numéricos como string; comparados como texto
        // "10" iría antes que "9". Se comparan numéricos cuando ambos lo son.
        const nx = Number(x);
        const ny = Number(y);
        const cmp =
          Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x < y ? -1 : x > y ? 1 : 0;
        return asc ? cmp : -cmp;
      });
    }

    const total = filas.length;
    if (this.tope !== null) filas = filas.slice(0, this.tope);

    if (this.soloConteo) return { data: null, error: null, count: total };
    if (this.unaSola) return { data: filas[0] ?? null, error: null, count: total };
    return { data: filas, error: null, count: total };
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
    return String(n);
  };

  const client = {
    from: (tabla: string) => new Builder(tablas, tabla, siguienteId),
  };

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
