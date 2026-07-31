/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El puente a las dos funciones de la 090
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── Por qué no pasa por `tenantDb(ctx)` ────────────────────────────────────
 *
 *  `tenantDb` cubre tablas: pone el `.eq('tenant_id', …)` que no se puede
 *  olvidar. No cubre `rpc()`, y no debería — una función de Postgres no tiene
 *  una columna que filtrar desde fuera. Es el mismo razonamiento y el mismo
 *  patrón que `packages/work/src/data/rpc.ts` de H9.
 *
 *  ── Por qué hacen falta funciones de Postgres ──────────────────────────────
 *
 *  `areas_signals` cuenta cinco tablas que son de OTROS carriles —`channels` de
 *  H6, `contacts` y `pipeline_stages` de H15, `canonical_values` y `documents`
 *  de H4—. Contarlas desde TypeScript obligaría a H11 a declarar cinco tablas
 *  ajenas en su `tables.d.ts` y a acoplarse a la forma interna de cada una. Con
 *  la función, este paquete no conoce ni el nombre de esas tablas.
 *
 *  `areas_seed_tenant` siembra el mapa leyendo la plantilla del giro (H4) y el
 *  catálogo, y tiene que ser UNA operación: un mapa a medio sembrar es un
 *  emprendedor que entra y ve tres de sus siete áreas, sin saber por qué.
 *
 *  ── Cómo se conserva el aislamiento ────────────────────────────────────────
 *
 *  `service_role` hace bypass de RLS, así que aquí el aislamiento NO lo pone
 *  Postgres: lo pone `p_tenant`. Por eso hay UNA sola manera de llamar
 *  —`llamarRpc(ctx, …)`— que inyecta `ctx.tenantId` ella misma y RECHAZA que
 *  venga en los argumentos. Un `p_tenant` que llega desde fuera es un
 *  `p_tenant` que pudo venir de la red.
 *
 *  ESLint prohíbe `adminDb` dentro de `routes/` y `services/`. Este archivo
 *  vive en `data/` justamente para que esa prohibición siga en pie donde
 *  importa.
 */
import { PlatformError, adminDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { parseSignals } from '../domain/requirements';
import type { AreaScript, Signals } from '../domain/types';
import { GUION_VACIO } from '../domain/types';

/** Las únicas funciones que H11 puede invocar. Una lista cerrada y no un
 *  `string`: así el nombre de la función nunca puede venir de fuera. */
const FUNCIONES = {
  signals: 'areas_signals',
  seed: 'areas_seed_tenant',
} as const;

type NombreRpc = (typeof FUNCIONES)[keyof typeof FUNCIONES];

interface ErrorPostgrest {
  message?: string;
  code?: string;
  details?: string;
}

/**
 * Traduce un error de Postgres a uno que cruza la frontera entre paquetes.
 *
 * `42883` (función inexistente) y `42P01` (relación inexistente) significan una
 * sola cosa: la migración 090 no se ha aplicado en este entorno. Decirlo con
 * esas palabras ahorra la tarde de depuración que costaría un "INTERNAL" pelón.
 */
function mapearError(error: ErrorPostgrest | null, fn: string): PlatformError | null {
  if (!error) return null;

  const codigo = error.code ?? '';
  if (codigo === '42883' || codigo === '42P01') {
    return new PlatformError(
      'INTERNAL',
      `La migración 090 no está aplicada en este entorno: falta ${fn}. Corre \`npm run migrate\`.`,
      { details: { code: codigo } },
    );
  }
  if (codigo === 'no_data_found' || codigo === 'P0002') {
    return new PlatformError('NOT_FOUND', 'La empresa no existe.', { details: { code: codigo } });
  }

  return new PlatformError('INTERNAL', `Falló ${fn}: ${error.message ?? 'error desconocido'}`, {
    details: { code: codigo },
  });
}

async function llamarRpc(
  ctx: TenantContext,
  fn: NombreRpc,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!ctx?.tenantId) {
    throw new PlatformError(
      'FORBIDDEN',
      'llamarRpc() sin tenantId. El contexto se arma con contextoDePeticion(req), ' +
        'nunca desde un header del navegador.',
    );
  }
  if ('p_tenant' in args) {
    // No se pisa en silencio: se rechaza. Pisarlo escondería el intento.
    throw new PlatformError('INTERNAL', 'p_tenant lo pone llamarRpc(), no el llamador');
  }

  const { data, error } = await adminDb().rpc(fn, { p_tenant: ctx.tenantId, ...args });
  const mapeado = mapearError(error as ErrorPostgrest | null, `la función ${fn}`);
  if (mapeado) throw mapeado;
  return data;
}

/**
 * La foto del negocio contra la que se evalúan los requisitos.
 *
 * Nunca lanza por una señal que falta: `parseSignals` rellena con cero, y la
 * función de Postgres ya devuelve cero para los carriles que no han aterrizado.
 * Un requisito que no se puede medir queda incumplido, que es lo correcto —
 * jamás cumplido por omisión.
 */
export async function readSignals(ctx: TenantContext): Promise<Signals> {
  return parseSignals(await llamarRpc(ctx, FUNCIONES.signals));
}

/**
 * Siembra el mapa desde la plantilla del giro. Devuelve cuántas áreas NUEVAS
 * escribió: `0` significa que ya estaba sembrado, no que algo falló.
 */
export async function seedAreas(ctx: TenantContext): Promise<number> {
  const n = await llamarRpc(ctx, FUNCIONES.seed);
  return typeof n === 'number' ? n : 0;
}

// ════════════════════════════════════════════════════════════════════════════
// El catálogo
// ════════════════════════════════════════════════════════════════════════════

/**
 * El guion del mini-onboarding de un área, para el giro de esta empresa.
 *
 * `app.area_catalog` es catálogo de la PLATAFORMA: no tiene `tenant_id`, es el
 * mismo para todos los clientes y por eso se lee con `adminDb()` — la misma vía
 * por la que H4 lee `app.industry_templates`. No hay dato de un cliente que
 * pudiera filtrarse por aquí: lo único que se lee es el guion que la plataforma
 * escribió para un giro.
 *
 * Precedencia: la fila del giro le gana a la de `'*'`. Si no hay ninguna,
 * devuelve el guion vacío y el mini-onboarding lo dice en vez de inventarse
 * preguntas.
 *
 * NO recibe `TenantContext`, a diferencia del resto de este archivo, y la
 * ausencia es deliberada: no hay nada del cliente que filtrar aquí. Aceptar un
 * `ctx` que la función ignora sugeriría un aislamiento que no está ocurriendo
 * —y el día que alguien agregue un dato por tenant a esta tabla, el compilador
 * no diría nada. El giro entra como parámetro explícito, resuelto por
 * `readIndustry(ctx)`, que sí lo acota.
 */
export async function readScript(
  areaSlug: string,
  industryId: string | null,
): Promise<AreaScript> {
  const giros = industryId ? [industryId, '*'] : ['*'];

  const { data, error } = await adminDb()
    .from('area_catalog')
    .select('industry_id, script')
    .eq('area_slug', areaSlug)
    .in('industry_id', giros);

  const mapeado = mapearError(error as ErrorPostgrest | null, 'la lectura del catálogo de áreas');
  if (mapeado) throw mapeado;

  const filas = (data ?? []) as Array<{ industry_id: string; script: unknown }>;
  const preferida =
    filas.find((f) => industryId && f.industry_id === industryId) ??
    filas.find((f) => f.industry_id === '*');

  return normalizarGuion(preferida?.script);
}

/** El guion que llega de la base, saneado. Un guion a medias no debe pintar
 *  `undefined` en la cara del emprendedor. */
export function normalizarGuion(raw: unknown): AreaScript {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...GUION_VACIO };
  const o = raw as Record<string, unknown>;

  const preguntas = Array.isArray(o.questions)
    ? o.questions
        .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
        .map((q) => ({ key: String(q.key ?? ''), prompt: String(q.prompt ?? '') }))
        .filter((q) => q.key && q.prompt)
    : [];

  const r = o.result;
  const resultado =
    typeof r === 'object' && r !== null && !Array.isArray(r)
      ? {
          kind: String((r as Record<string, unknown>).kind ?? 'nota'),
          label: String((r as Record<string, unknown>).label ?? ''),
        }
      : null;

  return {
    intro: typeof o.intro === 'string' ? o.intro : '',
    promise: typeof o.promise === 'string' ? o.promise : '',
    questions: preguntas,
    result: resultado && resultado.label ? resultado : null,
  };
}

/**
 * El giro de la empresa. Vive en `app.tenants`, que es una tabla GLOBAL (su
 * llave de aislamiento es `id`, no una columna `tenant_id`), así que no pasa
 * por `tenantDb` — pero el `.eq('id', ctx.tenantId)` sí lo pone esta función y
 * no el llamador.
 */
export async function readIndustry(ctx: TenantContext): Promise<string | null> {
  if (!ctx?.tenantId) {
    throw new PlatformError('FORBIDDEN', 'readIndustry() sin tenantId.');
  }

  const { data, error } = await adminDb()
    .from('tenants')
    .select('industry_type')
    .eq('id', ctx.tenantId)
    .maybeSingle();

  const mapeado = mapearError(error as ErrorPostgrest | null, 'la lectura del giro');
  if (mapeado) throw mapeado;

  const fila = data as { industry_type?: unknown } | null;
  return typeof fila?.industry_type === 'string' ? fila.industry_type : null;
}
