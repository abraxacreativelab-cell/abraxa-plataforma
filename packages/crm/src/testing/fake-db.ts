/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Base de datos en memoria con la forma de PostgREST
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Existe para que los criterios observables de H15 se verifiquen sin una base
 *  viva — que es también como corre CI, donde no hay `.env`.
 *
 *  ── Lo que la hace valer, y no ser un adorno ───────────────────────────────
 *
 *  1. **NO reimplementa el aislamiento por tenant.** El `.eq('tenant_id', …)`
 *     que separa a un cliente de otro lo pone `tenantDb(ctx)` de H1; este
 *     doble simplemente lo respeta como lo haría Postgres. Por eso la prueba
 *     "el tenant A no ve contactos del B" significa algo: si alguien rompiera
 *     `tenantDb`, se cae.
 *
 *  2. **SÍ reimplementa los índices únicos.** Están declarados abajo, uno por
 *     uno, con la misma llave que la migración que los crea. Sin ellos, la
 *     prueba de "dos webhooks concurrentes no crean dos contactos" sería
 *     teatro: pasaría igual con el código roto, porque nada rechazaría el
 *     segundo INSERT. Ese rechazo ES lo que se está probando.
 *
 *  Se instala con `__setClientForTests()`, el gancho que dejó H1.
 */
import type { AnyClient, MembershipRole, TenantContext } from '@abraxa/db';

export type Fila = Record<string, unknown>;

interface Resultado {
  data: Fila[] | Fila | null;
  error: { message: string; code?: string } | null;
  count: number | null;
}

/**
 * Los índices únicos de 120, 121 y 122, tal cual.
 *
 * `donde` reproduce los índices PARCIALES: el de `is_primary` sólo aplica a
 * las filas que lo tienen en `true`, y el de `external_id` sólo a las que
 * traen uno. Un doble que ignorara la cláusula `WHERE` rechazaría escrituras
 * que Postgres acepta, y las pruebas mentirían en la otra dirección.
 */
interface Unico {
  cols: string[];
  donde?: (f: Fila) => boolean;
}

const UNICOS: Record<string, Unico[]> = {
  contacts: [],
  contact_identities: [
    { cols: ['tenant_id', 'channel', 'identifier'] },
    { cols: ['tenant_id', 'contact_id', 'channel'], donde: (f) => f.is_primary === true },
  ],
  contact_tags: [{ cols: ['tenant_id', 'contact_id', 'tag'] }],
  contact_events: [
    {
      cols: ['tenant_id', 'external_id'],
      donde: (f) => f.external_id !== null && f.external_id !== undefined,
    },
  ],
  pipelines: [
    { cols: ['tenant_id', 'slug'] },
    { cols: ['tenant_id'], donde: (f) => f.is_default === true },
  ],
  pipeline_stages: [{ cols: ['tenant_id', 'pipeline_id', 'slug'] }],
  contact_stages: [{ cols: ['tenant_id', 'contact_id', 'pipeline_id'] }],
};

type Op = 'eq' | 'neq' | 'in' | 'is' | 'ilike' | 'lt' | 'gt' | 'gte' | 'lte';

interface Filtro {
  col: string;
  op: Op;
  valor: unknown;
}

/** `*texto*` de PostgREST → expresión regular sin distinción de mayúsculas. */
function comoIlike(valor: unknown, patron: string): boolean {
  if (valor === null || valor === undefined) return false;
  const cuerpo = patron
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/[*%]/g, '.*')
    .replace(/_/g, '.');
  return new RegExp(`^${cuerpo}$`, 'i').test(String(valor));
}

function cumpleFiltro(fila: Fila, f: Filtro): boolean {
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
    case 'ilike':
      return comoIlike(v, String(f.valor));
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

/**
 * Un `or(...)` de PostgREST: `campo.op.valor` separado por comas, más la
 * forma `id.in.(a,b,c)`. Se implementa lo que este paquete usa de verdad y
 * nada más — un mini-parser completo de PostgREST sería más código que el
 * paquete que prueba.
 */
function cumpleOr(fila: Fila, expresion: string): boolean {
  const partes: string[] = [];
  let nivel = 0;
  let actual = '';
  for (const c of expresion) {
    if (c === '(') nivel += 1;
    if (c === ')') nivel -= 1;
    if (c === ',' && nivel === 0) {
      partes.push(actual);
      actual = '';
      continue;
    }
    actual += c;
  }
  if (actual) partes.push(actual);

  return partes.some((p) => {
    const m = /^([^.]+)\.([^.]+)\.(.*)$/.exec(p.trim());
    if (!m) return false;
    const [, col, op, crudo] = m;
    if (!col || !op) return false;
    const valor = crudo ?? '';
    if (op === 'in') {
      const lista = valor.replace(/^\(|\)$/g, '').split(',').filter(Boolean);
      return cumpleFiltro(fila, { col, op: 'in', valor: lista });
    }
    return cumpleFiltro(fila, { col, op: op as Op, valor });
  });
}

class Builder implements PromiseLike<Resultado> {
  private filtros: Filtro[] = [];
  private ors: string[] = [];
  private orden: { col: string; asc: boolean } | null = null;
  private tope: number | null = null;
  private desde = 0;
  private conConteo = false;
  private unaSola = false;
  private accion: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Fila[] = [];
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
  ilike(col: string, patron: string): this {
    this.filtros.push({ col, op: 'ilike', valor: patron });
    return this;
  }
  lt(col: string, valor: unknown): this {
    this.filtros.push({ col, op: 'lt', valor });
    return this;
  }
  gt(col: string, valor: unknown): this {
    this.filtros.push({ col, op: 'gt', valor });
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
  or(expresion: string): this {
    this.ors.push(expresion);
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
  range(desde: number, hasta: number): this {
    this.desde = desde;
    this.tope = hasta - desde + 1;
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
    const coincidentes = (): Fila[] =>
      this.filas.filter(
        (f) => this.filtros.every((x) => cumpleFiltro(f, x)) && this.ors.every((o) => cumpleOr(f, o)),
      );

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
          ...fila,
        };
        if (this.choque(nueva)) return duplicado();
        this.filas.push(nueva);
        escritas.push(nueva);
      }
      return { data: this.devolverAfectadas ? escritas : null, error: null, count: null };
    }

    if (this.accion === 'update') {
      const patch = this.payload[0] ?? {};
      const objetivo = coincidentes();
      // Se valida ANTES de tocar nada: un UPDATE parcial que deja la mitad de
      // las filas movidas y la otra mitad no sería un estado que Postgres
      // pueda producir, y una prueba que lo asumiera probaría una ficción.
      for (const f of objetivo) {
        if (this.choque({ ...f, ...patch }, f.id)) return duplicado();
      }
      for (const f of objetivo) Object.assign(f, patch);
      return {
        data: this.devolverAfectadas ? objetivo : null,
        error: null,
        count: objetivo.length,
      };
    }

    if (this.accion === 'delete') {
      const objetivo = coincidentes();
      const fuera = new Set(objetivo);
      this.tablas.set(
        this.tabla,
        this.filas.filter((f) => !fuera.has(f)),
      );
      return {
        data: this.devolverAfectadas ? objetivo : null,
        error: null,
        count: objetivo.length,
      };
    }

    // SELECT
    let filas = coincidentes();

    if (this.orden) {
      const { col, asc } = this.orden;
      filas = [...filas].sort((a, b) => {
        const x = a[col];
        const y = b[col];
        // NULLS LAST, como el índice de 120. Sin esto, un contacto recién
        // creado sin actividad se colaría hasta arriba de la lista.
        const xVacio = x === null || x === undefined;
        const yVacio = y === null || y === undefined;
        if (xVacio && yVacio) return 0;
        if (xVacio) return 1;
        if (yVacio) return -1;
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
    if (this.desde > 0) filas = filas.slice(this.desde);
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
  extra: { role?: MembershipRole } = {},
): TenantContext {
  return {
    tenantId,
    tenantSlug: tenantId,
    userEmail: 'santiago@abraxa.club',
    role: extra.role ?? 'owner',
    areas: {},
  };
}
