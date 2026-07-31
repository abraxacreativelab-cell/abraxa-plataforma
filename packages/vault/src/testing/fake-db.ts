/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Una base de datos en memoria que habla como PostgREST.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Existe por una razón concreta: **CI corre `npm test` sin base de datos.**
 *  Si las pruebas de la bóveda necesitaran Postgres, no correrían en el PR —
 *  y una prueba que no corre en cada cambio es documentación, no una prueba.
 *
 *  Con esto, los criterios de aislamiento, de aprobación y de "nada se activa
 *  solo" se verifican en cada commit, en cualquier máquina.
 *
 *  H1 dejó `__setClientForTests()` en `@abraxa/db` justo para esto.
 *
 *  ── Qué NO cubre, y hay que decirlo ─────────────────────────────────────────
 *
 *  No es Postgres. No valida los CHECK, no aplica las llaves foráneas ni el
 *  RLS, y su `match_knowledge_chunks` calcula el coseno en JavaScript en vez
 *  de usar el índice HNSW. Esas cosas se verifican contra una base real con
 *  `npm run vault:verify` (ver README del paquete).
 *
 *  Lo que sí cubre es toda la lógica que vive en TypeScript, que es donde
 *  están los errores que se cometen a diario.
 */

type Fila = Record<string, unknown>;

interface Filtro {
  op: 'eq' | 'neq' | 'is' | 'in';
  col: string;
  val: unknown;
}

let contador = 0;
const uuid = (): string =>
  `00000000-0000-4000-8000-${String(++contador).padStart(12, '0')}`;

/** Índices únicos por tabla, para emular `onConflict` de un upsert. */
const UNICOS: Record<string, string[][]> = {
  canonical_values: [['tenant_id', 'key', 'scope_type', 'scope_id']],
  knowledge_chunks: [['document_id', 'chunk_index']],
  document_versions: [['document_id', 'version']],
};

/** Valores por defecto que en la base pone el DDL. */
const DEFAULTS: Record<string, Fila> = {
  documents: { status: 'draft', version: 1, source_kind: 'paste', tags: [], doc_type: 'otro', confidence: null },
  canonical_values: {
    active: false,
    currency: 'MXN',
    scope_type: 'tenant',
    scope_id: '',
    position: 0,
    // Las seis de la 031. Van explícitas para que `conflict_at != null` se
    // comporte igual aquí que contra Postgres.
    conflict_value: null,
    conflict_value_text: null,
    conflict_currency: null,
    conflict_note: null,
    conflict_doc_id: null,
    conflict_at: null,
  },
  knowledge_chunks: { embedding: null },
};

export interface FakeDb {
  from(tabla: string): Consulta;
  rpc(nombre: string, args: Fila): Promise<{ data: unknown; error: { message: string } | null }>;
  /** Acceso directo para preparar y verificar estado en las pruebas. */
  tabla(nombre: string): Fila[];
  sembrar(nombre: string, filas: Fila[]): void;
}

class Consulta implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private filtros: Filtro[] = [];
  private accion: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: Fila[] = [];
  private onConflict: string[] | null = null;
  private cardinalidad: 'muchas' | 'una' | 'quizaUna' = 'muchas';
  private soloConteo = false;
  private orden: Array<{ col: string; asc: boolean }> = [];
  private tope: number | null = null;

  constructor(
    private readonly store: Map<string, Fila[]>,
    private readonly tabla: string,
  ) {}

  private filas(): Fila[] {
    let f = this.store.get(this.tabla) ?? [];
    this.store.set(this.tabla, f);
    for (const { op, col, val } of this.filtros) {
      f = f.filter((r) => {
        const v = r[col];
        switch (op) {
          case 'eq':
            return String(v) === String(val);
          case 'neq':
            return String(v) !== String(val);
          case 'is':
            return val === null ? v == null : v === val;
          case 'in':
            return Array.isArray(val) && val.some((x) => String(x) === String(v));
          default:
            return true;
        }
      });
    }
    return f;
  }

  // ── filtros y modificadores ───────────────────────────────────────────────
  eq(col: string, val: unknown): this {
    this.filtros.push({ op: 'eq', col, val });
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filtros.push({ op: 'neq', col, val });
    return this;
  }
  is(col: string, val: unknown): this {
    this.filtros.push({ op: 'is', col, val });
    return this;
  }
  in(col: string, val: unknown[]): this {
    this.filtros.push({ op: 'in', col, val });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orden.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.tope = n;
    return this;
  }
  single(): this {
    this.cardinalidad = 'una';
    return this;
  }
  maybeSingle(): this {
    this.cardinalidad = 'quizaUna';
    return this;
  }

  // ── operaciones ───────────────────────────────────────────────────────────
  select(_cols?: string, opts?: { head?: boolean; count?: string }): this {
    // Encadenado tras insert/update se usa sólo para pedir las filas de vuelta;
    // por eso NO reescribe `this.accion`.
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
    this.onConflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null;
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

  // ── ejecución ─────────────────────────────────────────────────────────────
  private ejecutar(): { data: unknown; error: { message: string; code?: string } | null } {
    const todas = this.store.get(this.tabla) ?? [];
    this.store.set(this.tabla, todas);
    const defaults = DEFAULTS[this.tabla] ?? {};

    if (this.accion === 'insert' || this.accion === 'upsert') {
      const creadas: Fila[] = [];
      for (const cruda of this.payload) {
        const clave = this.onConflict ?? UNICOS[this.tabla]?.[0] ?? null;
        const existente = clave
          ? todas.find((r) => clave.every((c) => String(r[c]) === String(cruda[c])))
          : undefined;

        if (existente && this.accion === 'insert') {
          return {
            data: null,
            error: { message: 'duplicate key value violates unique constraint', code: '23505' },
          };
        }
        if (existente) {
          Object.assign(existente, cruda, { updated_at: new Date().toISOString() });
          creadas.push(existente);
          continue;
        }
        const fila: Fila = {
          ...defaults,
          id: this.tabla === 'knowledge_chunks' || this.tabla === 'document_versions' ? ++contador : uuid(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...cruda,
        };
        todas.push(fila);
        creadas.push(fila);
      }
      return this.empaquetar(creadas);
    }

    if (this.accion === 'update') {
      const objetivo = this.filas();
      const patch = this.payload[0] ?? {};
      for (const r of objetivo) Object.assign(r, patch, { updated_at: new Date().toISOString() });
      return this.empaquetar(objetivo);
    }

    if (this.accion === 'delete') {
      const objetivo = new Set(this.filas());
      this.store.set(
        this.tabla,
        todas.filter((r) => !objetivo.has(r)),
      );
      return this.empaquetar([...objetivo]);
    }

    let filas = this.filas();
    for (const { col, asc } of [...this.orden].reverse()) {
      filas = [...filas].sort((a, b) => {
        const x = a[col] as string | number | null;
        const y = b[col] as string | number | null;
        if (x === y) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.tope != null) filas = filas.slice(0, this.tope);
    return this.empaquetar(filas);
  }

  private empaquetar(filas: Fila[]): {
    data: unknown;
    error: { message: string; code?: string } | null;
    count?: number;
  } {
    if (this.soloConteo) return { data: null, error: null, count: filas.length };
    if (this.cardinalidad === 'una') {
      const f = filas[0];
      if (!f) return { data: null, error: { message: 'no rows returned', code: 'PGRST116' } };
      return { data: { ...f }, error: null };
    }
    if (this.cardinalidad === 'quizaUna') {
      const f = filas[0];
      return { data: f ? { ...f } : null, error: null };
    }
    return { data: filas.map((f) => ({ ...f })), error: null };
  }

  then<R1 = unknown, R2 = never>(
    onOk?:
      | ((v: { data: unknown; error: { message: string; code?: string } | null }) => R1 | PromiseLike<R1>)
      | null,
    onErr?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.ejecutar()).then(onOk, onErr);
  }
}

/** Coseno, para emular `match_knowledge_chunks` sin pgvector. */
function coseno(a: number[], b: number[]): number {
  let p = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    p += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : p / d;
}

export function createFakeDb(inicial: Record<string, Fila[]> = {}): FakeDb {
  const store = new Map<string, Fila[]>();
  for (const [t, filas] of Object.entries(inicial)) store.set(t, filas.map((f) => ({ ...f })));

  return {
    from: (tabla: string) => new Consulta(store, tabla),

    tabla: (nombre: string) => store.get(nombre) ?? [],

    sembrar: (nombre: string, filas: Fila[]) => {
      const actuales = store.get(nombre) ?? [];
      store.set(nombre, [...actuales, ...filas.map((f) => ({ ...f }))]);
    },

    async rpc(nombre: string, args: Fila) {
      if (nombre === 'match_knowledge_chunks') {
        const consulta = JSON.parse(String(args.p_embedding ?? '[]')) as number[];
        const min = Number(args.p_min_similarity ?? 0);
        const limite = Number(args.p_limit ?? 8);

        // Espeja el LEFT JOIN de la 032: un documento archivado ya no contesta.
        // Un trozo sin `document_id` sí: no tiene documento que archivar.
        const archivados = new Set(
          (store.get('documents') ?? [])
            .filter((d) => d.status === 'archived')
            .map((d) => String(d.id)),
        );

        const filas = (store.get('knowledge_chunks') ?? [])
          .filter(
            (c) =>
              c.tenant_id === args.p_tenant_id &&
              c.embedding != null &&
              !(c.document_id != null && archivados.has(String(c.document_id))),
          )
          .map((c) => ({
            id: c.id,
            document_id: c.document_id,
            content: c.content,
            chunk_index: c.chunk_index,
            similarity: coseno(JSON.parse(String(c.embedding)) as number[], consulta),
          }))
          .filter((c) => c.similarity >= min)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limite);
        return { data: filas, error: null };
      }

      if (nombre === 'search_documents') {
        const texto = String(args.p_query ?? '').toLowerCase();
        const palabras = texto.split(/\s+/).filter((p) => p.length > 2);
        const filas = (store.get('documents') ?? [])
          .filter((d) => d.tenant_id === args.p_tenant_id && d.status !== 'archived')
          .map((d) => {
            const heno = `${String(d.title ?? '')} ${String(d.content ?? '')}`.toLowerCase();
            const aciertos = palabras.filter((p) => heno.includes(p)).length;
            return {
              id: d.id,
              title: d.title,
              area_slug: d.area_slug,
              doc_type: d.doc_type,
              excerpt: String(d.content ?? '').slice(0, 120),
              rank: palabras.length ? aciertos / palabras.length : 0,
            };
          })
          .filter((d) => d.rank > 0)
          .sort((a, b) => b.rank - a.rank)
          .slice(0, Number(args.p_limit ?? 8));
        return { data: filas, error: null };
      }

      return { data: null, error: { message: `RPC desconocida en el doble: ${nombre}` } };
    },
  };
}

/** Reinicia el generador de ids. Deja las pruebas deterministas. */
export function resetFakeIds(): void {
  contador = 0;
}
