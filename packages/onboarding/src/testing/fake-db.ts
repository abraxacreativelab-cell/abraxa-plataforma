/**
 * Base de datos en memoria con la forma de PostgREST.
 *
 * Existe para que los criterios observables de H7 —sobre todo el #2, la
 * reanudación real— se puedan verificar sin una base viva. Que es también como
 * corre CI, donde no hay `.env`.
 *
 * Lo importante: **no reimplementa el aislamiento por tenant**. El
 * `.eq('tenant_id', …)` que separa a un cliente de otro lo pone `tenantDb(ctx)`
 * de H1, y este doble simplemente lo respeta como lo haría Postgres. Si alguien
 * rompiera `tenantDb`, las pruebas de aislamiento de aquí se caerían.
 *
 * Se instala con `__setClientForTests()`, el gancho que H1 dejó justo para esto.
 */
import type { AnyClient } from '@abraxa/db';

export type Fila = Record<string, unknown>;

interface Filtro {
  col: string;
  valor: unknown;
}

interface Resultado {
  data: Fila[] | null;
  error: { message: string } | null;
}

let contador = 0;
const nuevoId = (): string => `00000000-0000-4000-8000-${String(++contador).padStart(12, '0')}`;

class Builder implements PromiseLike<Resultado> {
  private filtros: Filtro[] = [];
  private orden: { col: string; asc: boolean } | null = null;
  private tope: number | null = null;
  private accion: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Fila[] = [];
  private patch: Fila = {};
  private conflicto: string[] = [];
  private ignorarDuplicados = false;
  private devolver = false;

  constructor(
    private readonly tablas: Map<string, Fila[]>,
    private readonly tabla: string,
    /** Ver `crearFakeDb`: simula una lectura que llegó antes que la escritura ajena. */
    private readonly lecturaCiega: () => boolean = () => false,
    /** Tuplas UNIQUE de esta tabla. Ver `crearFakeDb`. */
    private readonly unicos: string[][] = [],
  ) {}

  private get filas(): Fila[] {
    let f = this.tablas.get(this.tabla);
    if (!f) {
      f = [];
      this.tablas.set(this.tabla, f);
    }
    return f;
  }

  select(_cols?: string): this {
    if (this.accion === 'select') return this;
    this.devolver = true;
    return this;
  }

  insert(rows: Fila | Fila[]): this {
    this.accion = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows: Fila | Fila[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.accion = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflicto = (opts?.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    // `ignoreDuplicates` es la diferencia entre DO NOTHING y DO UPDATE, y con
    // ella se pisaba una entrevista entera. Un doble que no la distinguiera
    // haría verde la prueba de la carrera con el bug puesto.
    this.ignorarDuplicados = opts?.ignoreDuplicates === true;
    return this;
  }

  update(patch: Fila): this {
    this.accion = 'update';
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.accion = 'delete';
    return this;
  }

  eq(col: string, valor: unknown): this {
    this.filtros.push({ col, valor });
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

  maybeSingle(): PromiseLike<{ data: Fila | null; error: null }> {
    return this.then((r) => ({ data: r.data?.[0] ?? null, error: null }));
  }

  private coincide(fila: Fila): boolean {
    return this.filtros.every((f) => fila[f.col] === f.valor);
  }

  /**
   * La tupla UNIQUE que este INSERT violaría, o `null`.
   *
   * Sólo cuentan las tuplas cuyas columnas vienen TODAS en el payload: en
   * Postgres un UNIQUE con un NULL de por medio no choca, y una tupla a la que
   * le falta una columna aquí es exactamente ese caso.
   */
  private choqueDeUnicidad(p: Fila): string[] | null {
    for (const tupla of this.unicos) {
      if (tupla.some((c) => p[c] === undefined || p[c] === null)) continue;
      if (this.filas.some((f) => tupla.every((c) => f[c] === p[c]))) return tupla;
    }
    return null;
  }

  private ejecutar(): Resultado {
    switch (this.accion) {
      case 'insert': {
        for (const p of this.payload) {
          const chocada = this.choqueDeUnicidad(p);
          if (chocada) {
            // La forma exacta del error de PostgREST, porque el código de
            // llamada distingue el 23505 de cualquier otro fallo para decidir
            // si releer o reventar. Un doble que devolviera un error genérico
            // haría pasar una prueba que en Postgres se cae.
            return {
              data: null,
              error: {
                code: '23505',
                message: `duplicate key value violates unique constraint "${this.tabla}_${chocada.join('_')}_key"`,
              } as Resultado['error'],
            };
          }
        }
        const creadas = this.payload.map((p) => ({ id: nuevoId(), created_at: ahora(), updated_at: ahora(), ...p }));
        this.filas.push(...creadas);
        return { data: this.devolver ? creadas : null, error: null };
      }

      case 'upsert': {
        const salida: Fila[] = [];
        for (const p of this.payload) {
          const previa =
            this.conflicto.length > 0
              ? this.filas.find((f) => this.conflicto.every((c) => f[c] === p[c]))
              : undefined;
          if (previa) {
            // DO NOTHING: ni escribe ni devuelve fila. Quien pierde la carrera
            // se entera porque no le tocó nada, y vuelve a leer.
            if (this.ignorarDuplicados) continue;
            // DO UPDATE: pisa la fila con el payload. Es el comportamiento por
            // defecto de PostgREST, y por eso hay que pedir el otro a mano.
            Object.assign(previa, p);
            salida.push(previa);
          } else {
            const creada = { id: nuevoId(), created_at: ahora(), updated_at: ahora(), ...p };
            this.filas.push(creada);
            salida.push(creada);
          }
        }
        return { data: this.devolver ? salida : null, error: null };
      }

      case 'update': {
        const tocadas = this.filas.filter((f) => this.coincide(f));
        for (const f of tocadas) Object.assign(f, this.patch);
        return { data: this.devolver ? tocadas : null, error: null };
      }

      case 'delete': {
        const quedan = this.filas.filter((f) => !this.coincide(f));
        this.tablas.set(this.tabla, quedan);
        return { data: null, error: null };
      }

      default: {
        if (this.lecturaCiega()) return { data: [], error: null };
        let salida = this.filas.filter((f) => this.coincide(f));
        if (this.orden) {
          const { col, asc } = this.orden;
          salida = [...salida].sort((a, b) => {
            const x = a[col];
            const y = b[col];
            if (x === y) return 0;
            const menor = (x as number | string) < (y as number | string);
            return (menor ? -1 : 1) * (asc ? 1 : -1);
          });
        }
        if (this.tope !== null) salida = salida.slice(0, this.tope);
        // Copias: quien lee no debe poder mutar la "base" sin pasar por un
        // update, igual que con Postgres.
        return { data: salida.map((f) => ({ ...f })), error: null };
      }
    }
  }

  then<T1 = Resultado, T2 = never>(
    ok?: ((v: Resultado) => T1 | PromiseLike<T1>) | null,
    mal?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.ejecutar()).then(ok, mal);
  }
}

function ahora(): string {
  return new Date().toISOString();
}

export interface FakeDb {
  cliente: AnyClient;
  tablas: Map<string, Fila[]>;
  /** Las filas crudas de una tabla. Para afirmar sobre lo que de verdad se
   *  escribió, no sobre lo que devolvió una función. */
  filas(tabla: string): Fila[];
}

/**
 * @param lecturaCiega Mientras devuelva `true`, todo SELECT sale vacío.
 *
 * Es cómo se reproduce una carrera de verdad sin depender del orden en que el
 * planificador de promesas resuelva dos llamadas: una petición que leyó la
 * tabla ANTES de que otra insertara ve exactamente esto — nada — y sigue su
 * camino creyendo que es la primera. Sin el gancho, la única forma de llegar a
 * ese estado sería tener dos procesos.
 *
 * @param unicos Tuplas UNIQUE por tabla, p. ej.
 *   `{ onboarding_blueprints: [['tenant_id', 'session_id']] }`.
 *
 * Se declaran a mano porque este doble no lee el esquema. Y hay que declararlas
 * cuando la prueba dependa de ellas: un UNIQUE que sólo existe en la migración
 * es un UNIQUE que ninguna prueba verifica, y el camino que lo atrapa —releer y
 * quedarse con el que ganó— nunca correría hasta producción.
 */
export function crearFakeDb(
  inicial: Record<string, Fila[]> = {},
  lecturaCiega: () => boolean = () => false,
  unicos: Record<string, string[][]> = {},
): FakeDb {
  const tablas = new Map<string, Fila[]>(Object.entries(inicial).map(([k, v]) => [k, [...v]]));

  const cliente = {
    from: (tabla: string) => new Builder(tablas, tabla, lecturaCiega, unicos[tabla] ?? []),
  } as unknown as AnyClient;

  return {
    cliente,
    tablas,
    filas: (tabla) => tablas.get(tabla) ?? [],
  };
}
