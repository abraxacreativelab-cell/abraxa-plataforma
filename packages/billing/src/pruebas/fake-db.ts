/**
 * Un doble en memoria de la parte de PostgREST que este paquete usa.
 *
 * Existe porque las pruebas que de verdad importan aquí —"un webhook
 * reenviado dos veces no crea dos tenants"— son sobre el comportamiento de la
 * BASE, no sobre el de una función. Con `vi.mock()` de `store.ts` se estaría
 * probando que el mock devuelve lo que le pedimos que devuelva; con esto se
 * prueba contra algo que se comporta como Postgres, incluida la violación de
 * unicidad que ES el mecanismo de idempotencia.
 *
 * Sólo implementa lo que store.ts llama. Si algún día llama a algo más, esto
 * truena con un mensaje claro en vez de devolver `undefined` en silencio.
 */

export interface RespuestaError {
  code?: string;
  message: string;
}

/** Postgres: violación de unicidad. */
export const UNIQUE_VIOLATION = '23505';

type Fila = Record<string, unknown>;

interface Tabla {
  filas: Fila[];
  /** Columnas que forman restricciones UNIQUE. Cada entrada es una llave. */
  unicas: string[][];
}

export class FakeDb {
  private readonly tablas = new Map<string, Tabla>();

  /** Falla la próxima operación sobre esta tabla, para probar los caminos de error. */
  fallarEn: { tabla: string; mensaje: string } | null = null;

  /**
   * Falla la próxima LECTURA sobre esta tabla, sin tocar las escrituras.
   *
   * Hace falta para probar el caso en que el INSERT choca contra el UNIQUE y
   * además no se puede leer si el evento ya se había terminado.
   */
  fallarEnLectura: { tabla: string; mensaje: string } | null = null;

  constructor() {
    this.definir('billing_events', [['stripe_event_id']]);
    this.definir('subscriptions', [['tenant_id']]);
    this.definir('tenants', [['slug']]);
    this.definir('plans', [['id']]);
  }

  definir(nombre: string, unicas: string[][] = []): void {
    this.tablas.set(nombre, { filas: [], unicas });
  }

  tabla(nombre: string): Fila[] {
    const t = this.tablas.get(nombre);
    if (!t) throw new Error(`El doble no conoce la tabla '${nombre}'.`);
    return t.filas;
  }

  sembrar(nombre: string, filas: Fila[]): void {
    this.tabla(nombre).push(...filas);
  }

  /** La superficie que consume `adminDb()`. */
  from(nombre: string): Consulta {
    const t = this.tablas.get(nombre);
    if (!t) throw new Error(`El doble no conoce la tabla '${nombre}'.`);
    return new Consulta(this, t, nombre);
  }

  /** `true` si la fila choca contra alguna restricción UNIQUE de la tabla. */
  choca(t: Tabla, fila: Fila): boolean {
    return t.unicas.some((llave) => {
      if (llave.some((c) => fila[c] === undefined || fila[c] === null)) return false;
      return t.filas.some((f) => llave.every((c) => f[c] === fila[c]));
    });
  }
}

type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

class Consulta implements PromiseLike<{ data: unknown; error: RespuestaError | null }> {
  private op: Op = 'select';
  private payload: Fila[] = [];
  private readonly filtros: Array<[string, unknown]> = [];
  private unaSola = false;
  private onConflict: string | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly t: Tabla,
    private readonly nombre: string,
  ) {}

  select(_cols?: string): this {
    this.op = 'select';
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filtros.push([col, val]);
    return this;
  }

  insert(rows: Fila | Fila[]): this {
    this.op = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows: Fila | Fila[], opts?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.onConflict = opts?.onConflict ?? null;
    return this;
  }

  update(patch: Fila): this {
    this.op = 'update';
    this.payload = [patch];
    return this;
  }

  maybeSingle(): this {
    this.unaSola = true;
    return this;
  }

  then<R1 = { data: unknown; error: RespuestaError | null }, R2 = never>(
    alCumplir?: ((v: { data: unknown; error: RespuestaError | null }) => R1 | PromiseLike<R1>) | null,
    alFallar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.ejecutar()).then(alCumplir, alFallar);
  }

  private coincide(f: Fila): boolean {
    return this.filtros.every(([c, v]) => f[c] === v);
  }

  private ejecutar(): { data: unknown; error: RespuestaError | null } {
    const fallo = this.db.fallarEn;
    if (fallo && fallo.tabla === this.nombre) {
      this.db.fallarEn = null;
      return { data: null, error: { message: fallo.mensaje } };
    }

    const falloLectura = this.db.fallarEnLectura;
    if (this.op === 'select' && falloLectura && falloLectura.tabla === this.nombre) {
      this.db.fallarEnLectura = null;
      return { data: null, error: { message: falloLectura.mensaje } };
    }

    switch (this.op) {
      case 'select': {
        const encontradas = this.t.filas.filter((f) => this.coincide(f));
        return { data: this.unaSola ? (encontradas[0] ?? null) : encontradas, error: null };
      }

      case 'insert': {
        for (const fila of this.payload) {
          if (this.db.choca(this.t, fila)) {
            return {
              data: null,
              error: { code: UNIQUE_VIOLATION, message: 'duplicate key value violates unique constraint' },
            };
          }
          this.t.filas.push({ ...fila });
        }
        return { data: null, error: null };
      }

      case 'upsert': {
        const llave = this.onConflict?.split(',').map((c) => c.trim()) ?? [];
        for (const fila of this.payload) {
          const i = llave.length
            ? this.t.filas.findIndex((f) => llave.every((c) => f[c] === fila[c]))
            : -1;
          if (i >= 0) this.t.filas[i] = { ...this.t.filas[i], ...fila };
          else this.t.filas.push({ ...fila });
        }
        return { data: null, error: null };
      }

      case 'update': {
        const patch = this.payload[0] ?? {};
        for (const f of this.t.filas) {
          if (this.coincide(f)) Object.assign(f, patch);
        }
        return { data: null, error: null };
      }

      default:
        throw new Error(`El doble no implementa '${this.op}'.`);
    }
  }
}
