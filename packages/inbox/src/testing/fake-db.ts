/**
 * Base de datos en memoria con la forma de PostgREST.
 *
 * Existe para que los ocho criterios observables de H6 se puedan verificar sin
 * una base viva — que es también como corre CI, donde no hay `.env`.
 *
 * Lo importante, igual que en el doble de H3: **no reimplementa el
 * aislamiento**. El `.eq('tenant_id', …)` que separa a un cliente de otro lo
 * pone `tenantDb(ctx)` de H1, y este doble simplemente lo respeta como lo haría
 * Postgres. Por eso el criterio #7 —un tenant no ve los hilos de otro— se
 * prueba de verdad aquí: si alguien rompiera `tenantDb`, esa prueba se caería.
 *
 * Lo que SÍ reimplementa, porque de ahí cuelga medio handoff:
 *
 *   · El índice único parcial `(tenant_id, external_id)` de `messages`. Sin él,
 *     las pruebas de idempotencia del criterio #4 no probarían nada.
 *   · El UNIQUE `(tenant_id, channel_id, external_address)` de `threads`.
 */
import type { AnyClient } from '@abraxa/db';

export type Fila = Record<string, unknown>;

interface Filtro {
  col: string;
  op: 'eq' | 'gte' | 'lte' | 'in';
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
  if (f.op === 'in') return Array.isArray(f.valor) && f.valor.includes(v);
  if (v === undefined || v === null) return false;
  const a = String(v);
  const b = String(f.valor);
  return f.op === 'gte' ? a >= b : a <= b;
}

const ERROR_DUPLICADO = {
  message: 'duplicate key value violates unique constraint',
  code: '23505',
};

/** Las llaves únicas que de verdad importan para las pruebas de H6. */
const UNICOS: Record<string, string[][]> = {
  // Índice parcial: sólo aplica cuando `external_id` no es NULL.
  messages: [['tenant_id', 'external_id']],
  threads: [['tenant_id', 'channel_id', 'external_address']],
};

function violaUnico(tabla: string, filas: Fila[], nueva: Fila): boolean {
  for (const llave of UNICOS[tabla] ?? []) {
    // Parcial: si alguna columna de la llave es NULL, el índice no aplica.
    if (llave.some((c) => nueva[c] === null || nueva[c] === undefined)) continue;
    if (filas.some((f) => llave.every((c) => f[c] === nueva[c]))) return true;
  }
  return false;
}

class Builder implements PromiseLike<Resultado> {
  private filtros: Filtro[] = [];
  private orden: { col: string; asc: boolean } | null = null;
  private tope: number | null = null;
  private soloConteo = false;
  private unaSola = false;
  private exigeUna = false;
  private accion: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Fila[] = [];
  private devolverEscritas = false;
  private conflicto: string[] = [];

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
      this.devolverEscritas = true;
      return this;
    }
    if (opts?.count) this.soloConteo = true;
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

  in(col: string, valores: unknown[]): this {
    this.filtros.push({ col, op: 'in', valor: valores });
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

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
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
    this.exigeUna = true;
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
        if (violaUnico(this.tabla, this.filas, fila)) {
          return { data: null, error: { ...ERROR_DUPLICADO }, count: null };
        }
        const nueva: Fila = {
          id: this.siguienteId(),
          created_at: new Date().toISOString(),
          ...fila,
        };
        this.filas.push(nueva);
        escritas.push(nueva);
      }
      const data = this.devolverEscritas ? (this.unaSola ? (escritas[0] ?? null) : escritas) : null;
      return { data, error: null, count: null };
    }

    if (this.accion === 'update') {
      const patch = this.payload[0] ?? {};
      const objetivo = coincidentes();
      for (const f of objetivo) {
        // Un UPDATE también puede chocar con un índice único.
        const candidata = { ...f, ...patch };
        const otras = this.filas.filter((x) => x !== f);
        if (violaUnico(this.tabla, otras, candidata)) {
          return { data: null, error: { ...ERROR_DUPLICADO }, count: null };
        }
      }
      for (const f of objetivo) Object.assign(f, patch);
      const data = this.devolverEscritas
        ? this.unaSola
          ? (objetivo[0] ?? null)
          : objetivo
        : objetivo;
      return { data, error: null, count: objetivo.length };
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
        // NULLS LAST en descendente, que es como pide la bandeja.
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
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
    if (this.tope !== null) filas = filas.slice(0, this.tope);

    if (this.soloConteo) return { data: null, error: null, count: total };
    if (this.unaSola) {
      const fila = filas[0] ?? null;
      if (!fila && this.exigeUna) {
        return { data: null, error: { message: 'no rows', code: 'PGRST116' }, count: 0 };
      }
      return { data: fila, error: null, count: total };
    }
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
  tabla(nombre: string): Fila[];
  sembrar(nombre: string, filas: Fila[]): void;
  reset(): void;
  client: AnyClient;
}

export function createFakeDb(datos: Record<string, Fila[]> = {}): FakeDb {
  const tablas = new Map<string, Fila[]>();
  for (const [k, v] of Object.entries(datos)) tablas.set(k, v.map((f) => ({ ...f })));

  let n = 0;
  const siguienteId = (): string => {
    n += 1;
    return `id-${n}`;
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
