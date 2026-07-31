/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Base de datos en memoria con la forma de PostgREST
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Existe para que los criterios observables de H17 se verifiquen sin una base
 *  viva — que es también como corre CI, donde no hay `.env`.
 *
 *  Es un pariente cercano del doble de H15 (`packages/crm/src/testing/fake-db.ts`)
 *  y está COPIADO a propósito en vez de importado: `@abraxa/crm` no es
 *  dependencia de este paquete, y agregarla para un arnés de pruebas ataría el
 *  carril de las credenciales al del CRM sin ninguna razón de producto.
 *
 *  ── Lo que lo hace valer, y no ser un adorno ───────────────────────────────
 *
 *  1. **NO reimplementa el aislamiento por tenant.** El `.eq('tenant_id', …)`
 *     que separa a un cliente de otro lo pone `tenantDb(ctx)` de H1; este
 *     doble simplemente lo respeta como lo haría Postgres. Por eso la prueba
 *     "la empresa A no puede leer la credencial de la B" significa algo: si
 *     alguien rompiera `tenantDb`, se cae.
 *
 *  2. **SÍ reimplementa los índices únicos**, incluido el PARCIAL del ruteo
 *     inverso —`(provider, external_account_id)` donde no es null y no está
 *     revocada—. Sin él, la prueba de "la misma página de Facebook no se
 *     conecta a dos empresas" sería teatro: pasaría igual con el código roto,
 *     porque nada rechazaría el segundo INSERT. Ese 23505 ES lo que se prueba.
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

interface Unico {
  cols: string[];
  donde?: (f: Fila) => boolean;
}

/** Los índices únicos de 140, tal cual los declara la migración. */
const UNICOS: Record<string, Unico[]> = {
  tenant_integrations: [
    { cols: ['tenant_id', 'provider', 'external_account_id'] },
    // El del ruteo inverso: una cuenta externa viva pertenece a UNA empresa.
    {
      cols: ['provider', 'external_account_id'],
      donde: (f) =>
        f.external_account_id !== null &&
        f.external_account_id !== undefined &&
        f.status !== 'revoked',
    },
  ],
  integration_events: [],
};

type Op = 'eq' | 'neq' | 'in' | 'is' | 'ilike' | 'lt' | 'gt' | 'gte' | 'lte' | 'not';

interface Filtro {
  col: string;
  op: Op;
  valor: unknown;
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
    case 'not':
      return v !== f.valor;
    case 'ilike': {
      if (v === null || v === undefined) return false;
      const cuerpo = String(f.valor)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/[*%]/g, '.*')
        .replace(/_/g, '.');
      return new RegExp(`^${cuerpo}$`, 'i').test(String(v));
    }
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
  private unaSola = false;
  private accion: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Fila[] = [];
  private devolverAfectadas = false;
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
  not(col: string, _op: string, valor: unknown): this {
    this.filtros.push({ col, op: 'not', valor });
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
    const coincidentes = (): Fila[] =>
      this.filas.filter((f) => this.filtros.every((x) => cumpleFiltro(f, x)));

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

    let filas = coincidentes();

    if (this.orden) {
      const { col, asc } = this.orden;
      filas = [...filas].sort((a, b) => {
        const x = a[col];
        const y = b[col];
        const xVacio = x === null || x === undefined;
        const yVacio = y === null || y === undefined;
        if (xVacio && yVacio) return 0;
        if (xVacio) return 1;
        if (yVacio) return -1;
        const sx = String(x);
        const sy = String(y);
        const cmp = sx < sy ? -1 : sx > sy ? 1 : 0;
        return asc ? cmp : -cmp;
      });
    }

    const total = filas.length;
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
  extra: { role?: MembershipRole; email?: string } = {},
): TenantContext {
  return {
    tenantId,
    tenantSlug: tenantId,
    userEmail: extra.email ?? 'santiago@abraxa.club',
    role: extra.role ?? 'owner',
    areas: {},
  };
}

/**
 * Una llave de 32 bytes en base64, determinista, para las pruebas.
 *
 * No es un secreto: es `'k'` repetido y luego `'j'`, y su único trabajo es que
 * `INTEGRATIONS_KEY` tenga el largo correcto. Las pruebas que importan no
 * dependen de qué llave sea, sino de que sin ella el sistema se caiga.
 */
export const LLAVE_DE_PRUEBA = Buffer.alloc(32, 'k').toString('base64');
export const LLAVE_DE_PRUEBA_2 = Buffer.alloc(32, 'j').toString('base64');
