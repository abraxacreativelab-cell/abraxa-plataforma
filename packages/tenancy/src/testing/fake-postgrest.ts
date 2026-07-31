/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Un doble de PostgREST en memoria — deliberadamente PERMISIVO.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── La propiedad que lo hace valer algo ───────────────────────────────────
 *
 * Este almacén guarda las filas de TODAS las empresas juntas y **no filtra
 * nada por su cuenta**. Sólo aplica los filtros que el código bajo prueba pide
 * explícitamente.
 *
 * Eso es a propósito, y es lo único que hace que la prueba de aislamiento
 * signifique algo. Un doble "seguro" que escondiera las filas de otras
 * empresas haría pasar el test aunque el código hubiera olvidado su
 * `.eq('tenant_id', …)`: el test estaría comprobando el doble, no el código.
 *
 * Aquí es al revés. Si una consulta se olvida de acotar por empresa, este
 * doble le entrega encantado las filas del vecino y la prueba falla — que es
 * exactamente lo que se quiere que pase.
 *
 * ── Lo que este doble NO es ───────────────────────────────────────────────
 *
 * No es Postgres. No valida CHECK, ni llaves foráneas, ni RLS, ni ejecuta una
 * sola línea de las funciones de las migraciones 011 y 012. Todo eso se prueba
 * contra Postgres de verdad en `pg.test.ts`, que corre cuando hay una
 * `TENANCY_TEST_DATABASE_URL`.
 *
 * `rpc()` no trae lógica: lanza salvo que la prueba registre un handler. Si
 * implementara `provision_tenant` en JavaScript, las pruebas de alta estarían
 * verificando esa reimplementación y no el SQL que corre en producción.
 */

export type Fila = Record<string, unknown>;

export interface ResultadoFake<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count: number | null;
}

type ManejadorRpc = (args: Record<string, unknown>) => unknown;

let contador = 0;
const uuidFalso = (): string => {
  contador += 1;
  const n = contador.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${n}`;
};

/** Valores por defecto que Postgres pondría solo. */
const DEFAULTS: Record<string, () => Fila> = {
  tenants: () => ({
    id: uuidFalso(),
    industry_type: null,
    stage: null,
    settings: {},
    plan: 'free',
    status: 'active',
    created_at: new Date().toISOString(),
  }),
  users: () => ({
    name: null,
    avatar_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  memberships: () => ({ created_at: new Date().toISOString() }),
  area_grants: () => ({}),
  invitations: () => ({
    id: uuidFalso(),
    areas: {},
    invited_by: null,
    accepted_at: null,
    created_at: new Date().toISOString(),
  }),
  tenant_events: () => ({
    id: uuidFalso(),
    payload: {},
    created_at: new Date().toISOString(),
    delivered_at: null,
  }),
  plans: () => ({
    limits: {},
    position: 0,
    active: true,
    created_at: new Date().toISOString(),
  }),
};

type Filtro = (f: Fila) => boolean;

class Consulta<T = unknown> implements PromiseLike<ResultadoFake<T>> {
  private filtros: Filtro[] = [];
  private _limite: number | null = null;
  private _orden: string | null = null;
  private _head = false;
  private _contar = false;
  private _single: 'maybe' | 'one' | null = null;
  private _devolver = false;

  constructor(
    private readonly almacen: AlmacenFake,
    private readonly tabla: string,
    private readonly op: 'select' | 'insert' | 'upsert' | 'update' | 'delete',
    private readonly carga?: Fila[] | Fila,
    private readonly opciones?: { onConflict?: string },
  ) {}

  // ── Filtros ──────────────────────────────────────────────────────────────
  eq(col: string, val: unknown): this {
    this.filtros.push((f) => f[col] === val);
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filtros.push((f) => f[col] !== val);
    return this;
  }
  is(col: string, val: null): this {
    this.filtros.push((f) => (f[col] ?? null) === val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filtros.push((f) => vals.includes(f[col]));
    return this;
  }
  lt(col: string, val: string): this {
    this.filtros.push((f) => String(f[col]) < val);
    return this;
  }
  limit(n: number): this {
    this._limite = n;
    return this;
  }
  order(col: string): this {
    this._orden = col;
    return this;
  }
  maybeSingle(): this {
    this._single = 'maybe';
    return this;
  }
  single(): this {
    this._single = 'one';
    return this;
  }

  /**
   * En una consulta, elige columnas (aquí se ignoran: se devuelve la fila
   * entera). Después de una mutación, pide las filas afectadas.
   */
  select(_cols?: string, opciones?: { head?: boolean; count?: 'exact' | 'planned' | 'estimated' }): this {
    if (this.op !== 'select') this._devolver = true;
    if (opciones?.head) this._head = true;
    if (opciones?.count) this._contar = true;
    return this;
  }

  // ── Ejecución ────────────────────────────────────────────────────────────
  private filtrar(filas: Fila[]): Fila[] {
    return filas.filter((f) => this.filtros.every((p) => p(f)));
  }

  private ejecutar(): ResultadoFake<T> {
    const filas = this.almacen.tabla(this.tabla);

    let resultado: Fila[];

    switch (this.op) {
      case 'select': {
        resultado = this.filtrar(filas);
        if (this._orden) {
          const col = this._orden;
          resultado = [...resultado].sort((a, b) =>
            String(a[col] ?? '').localeCompare(String(b[col] ?? '')),
          );
        }
        const total = resultado.length;
        if (this._limite !== null) resultado = resultado.slice(0, this._limite);
        if (this._head) return { data: null, error: null, count: this._contar ? total : null };
        break;
      }

      case 'insert': {
        const nuevas = this.almacen.insertar(this.tabla, this.carga ?? []);
        resultado = nuevas;
        break;
      }

      case 'upsert': {
        const claves = (this.opciones?.onConflict ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        resultado = this.almacen.upsert(this.tabla, this.carga ?? [], claves);
        break;
      }

      case 'update': {
        const afectadas = this.filtrar(filas);
        for (const f of afectadas) Object.assign(f, this.carga as Fila);
        resultado = afectadas;
        break;
      }

      case 'delete': {
        const afectadas = this.filtrar(filas);
        this.almacen.reemplazar(
          this.tabla,
          filas.filter((f) => !afectadas.includes(f)),
        );
        resultado = afectadas;
        break;
      }
    }

    if (this._single) {
      if (resultado.length > 1) {
        return {
          data: null,
          error: { message: 'se esperaba una sola fila', code: 'PGRST116' },
          count: null,
        };
      }
      return { data: (resultado[0] ?? null) as T, error: null, count: null };
    }

    if (this.op !== 'select' && !this._devolver) {
      return { data: null, error: null, count: null };
    }

    return {
      data: structuredClone(resultado) as T,
      error: null,
      count: this._contar ? resultado.length : null,
    };
  }

  then<R1 = ResultadoFake<T>, R2 = never>(
    alCumplir?: ((v: ResultadoFake<T>) => R1 | PromiseLike<R1>) | null,
    alFallar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    try {
      return Promise.resolve(this.ejecutar()).then(alCumplir, alFallar);
    } catch (e) {
      return Promise.reject(e).then(alCumplir, alFallar);
    }
  }
}

export class AlmacenFake {
  private readonly tablas = new Map<string, Fila[]>();
  private readonly rpcs = new Map<string, ManejadorRpc>();

  /** Las llamadas a `rpc()`, para poder afirmar sobre ellas en las pruebas. */
  readonly llamadasRpc: Array<{ nombre: string; args: Record<string, unknown> }> = [];

  tabla(nombre: string): Fila[] {
    const actual = this.tablas.get(nombre);
    if (actual) return actual;
    const nueva: Fila[] = [];
    this.tablas.set(nombre, nueva);
    return nueva;
  }

  reemplazar(nombre: string, filas: Fila[]): void {
    this.tablas.set(nombre, filas);
  }

  /** Siembra directa, sin pasar por la capa que se está probando. */
  sembrar(nombre: string, filas: Fila | Fila[]): Fila[] {
    return this.insertar(nombre, filas);
  }

  insertar(nombre: string, carga: Fila | Fila[]): Fila[] {
    const entrantes = Array.isArray(carga) ? carga : [carga];
    const defaults = DEFAULTS[nombre] ?? (() => ({}));
    const destino = this.tabla(nombre);
    const nuevas = entrantes.map((f) => ({ ...defaults(), ...f }));
    destino.push(...nuevas);
    return nuevas;
  }

  upsert(nombre: string, carga: Fila | Fila[], claves: string[]): Fila[] {
    const entrantes = Array.isArray(carga) ? carga : [carga];
    const destino = this.tabla(nombre);
    const defaults = DEFAULTS[nombre] ?? (() => ({}));
    const salida: Fila[] = [];

    for (const entrante of entrantes) {
      const existente =
        claves.length > 0
          ? destino.find((f) => claves.every((k) => f[k] === entrante[k]))
          : undefined;

      if (existente) {
        Object.assign(existente, entrante);
        salida.push(existente);
      } else {
        const nueva = { ...defaults(), ...entrante };
        destino.push(nueva);
        salida.push(nueva);
      }
    }
    return salida;
  }

  /** Registra la implementación de una función de base de datos para una prueba. */
  registrarRpc(nombre: string, manejador: ManejadorRpc): void {
    this.rpcs.set(nombre, manejador);
  }

  limpiar(): void {
    this.tablas.clear();
    this.rpcs.clear();
    this.llamadasRpc.length = 0;
  }

  /** El objeto que se le pasa a `__setClientForTests`. */
  cliente(): {
    from: (tabla: string) => {
      select: (cols?: string, opts?: { head?: boolean; count?: 'exact' }) => Consulta;
      insert: (filas: Fila | Fila[]) => Consulta;
      upsert: (filas: Fila | Fila[], opts?: { onConflict?: string }) => Consulta;
      update: (patch: Fila) => Consulta;
      delete: () => Consulta;
    };
    rpc: (nombre: string, args: Record<string, unknown>) => Promise<ResultadoFake>;
  } {
    return {
      from: (tabla: string) => ({
        select: (cols?: string, opts?: { head?: boolean; count?: 'exact' }) =>
          new Consulta(this, tabla, 'select').select(cols, opts),
        insert: (filas: Fila | Fila[]) => new Consulta(this, tabla, 'insert', filas),
        upsert: (filas: Fila | Fila[], opts?: { onConflict?: string }) =>
          new Consulta(this, tabla, 'upsert', filas, opts),
        update: (patch: Fila) => new Consulta(this, tabla, 'update', patch),
        delete: () => new Consulta(this, tabla, 'delete'),
      }),

      rpc: async (nombre: string, args: Record<string, unknown>) => {
        this.llamadasRpc.push({ nombre, args });
        const manejador = this.rpcs.get(nombre);
        if (!manejador) {
          throw new Error(
            `El doble no implementa la función '${nombre}' a propósito. ` +
              'Su lógica vive en SQL (migraciones 011/012) y se prueba contra Postgres real en ' +
              'pg.test.ts. Si esta prueba sólo necesita el resultado, registra un handler con ' +
              '`almacen.registrarRpc()`.',
          );
        }
        try {
          return { data: manejador(args), error: null, count: null };
        } catch (e) {
          const err = e as { message?: string; code?: string };
          return {
            data: null,
            error: { message: err.message ?? String(e), code: err.code ?? '' },
            count: null,
          };
        }
      },
    };
  }
}
