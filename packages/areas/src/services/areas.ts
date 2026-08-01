/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El motor del mapa: sembrar, reconciliar, desbloquear
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── Dónde se decide un desbloqueo ──────────────────────────────────────────
 *
 *  Aquí no. La decisión es de `domain/state.reconcile()`, que es pura y no sabe
 *  qué es una base de datos. Este archivo hace las tres cosas que sí necesitan
 *  el mundo: leer las filas, leer las señales, y escribir el estado nuevo.
 *
 *  Separarlo así es lo que hace verificable el criterio 2 del handoff —*"cumplir
 *  un requisito desbloquea sola el área, sin que nadie apriete nada"*—: la regla
 *  se prueba sin base, y aquí sólo se prueba que lo que la regla decidió, se
 *  escribe.
 *
 *  ── Cuándo se reconcilia ───────────────────────────────────────────────────
 *
 *  En cada lectura del mapa y de la navegación. No hay cron, no hay trabajo en
 *  cola, no hay que acordarse de llamar a nada desde el carril que cambió el
 *  dato: si el emprendedor conectó un canal, la próxima vez que cargue una
 *  página su área ya está abierta. "Sin que nadie apriete nada" incluye a los
 *  otros trece handoffs.
 *
 *  El costo es una llamada más por carga: una función de Postgres que cuenta
 *  siete cosas con índices por `tenant_id`. A cambio, ningún carril tiene que
 *  saber que H11 existe para que el desbloqueo funcione.
 *
 *  ── Los permisos NO se reinventan aquí ─────────────────────────────────────
 *
 *  El RBAC por área es de H2 y ya existe: `app.area_grants` con RLS, y el mapa
 *  `ctx.areas` que arma `loadAreaGrants()`. Este archivo lo CONSUME —lee
 *  `ctx.areas` con la misma precedencia de comodín que `hasArea()`— y no
 *  escribe un segundo modelo. `packages/areas` no depende de `@abraxa/tenancy`
 *  a propósito: depender de él para leer un mapa que ya viene en el contexto
 *  sería acoplar dos paquetes por nada.
 */
import { ACCESS_RANK } from '@abraxa/config';
import { PlatformError, tenantDb } from '@abraxa/db';
import type { AreaAccess, AreaSummary, TenantContext } from '@abraxa/db';
import { completionRatio, evaluate, parseProgress } from '../domain/requirements';
import { completeOnboarding, navegable, reconcile, startOnboarding } from '../domain/state';
import type {
  AreaCard,
  AreaState,
  BusinessMap,
  Progress,
  Signals,
  TenantAreaRow,
} from '../domain/types';
import { readSignals, seedAreas } from '../data/rpc';
import { listMilestones } from './milestones';

/** Tope de áreas por empresa. No es una paginación: es un techo de cordura.
 *  Un mapa con doscientas áreas no es un mapa, es una lista de pendientes. */
export const LIMITE_AREAS = 60;

// ════════════════════════════════════════════════════════════════════════════
// Permisos — consumiendo el modelo de H2, sin duplicarlo
// ════════════════════════════════════════════════════════════════════════════

const esAccesoValido = (v: unknown): v is AreaAccess =>
  typeof v === 'string' && Object.hasOwn(ACCESS_RANK, v);

/**
 * El acceso del usuario a un área, con la precedencia de H2: el comodín `'*'`
 * —que es lo que reciben `owner` y `admin`— le gana al grant por área.
 *
 * `null` significa "sin acceso", que es el default: deny por defecto, igual que
 * en `hasArea()`. Un grant con un valor que no es `view|edit|admin` se trata
 * como ausente aquí en vez de lanzar, porque H2 ya lanza al ARMAR el contexto
 * (`loadAreaGrants`): si esa fila llegó hasta acá, es que H2 la aceptó, y
 * volver a caerse en la capa de lectura sólo tumbaría el mapa dos veces.
 */
export function accessFor(ctx: TenantContext, areaSlug: string): AreaAccess | null {
  const areas = ctx?.areas ?? {};
  const grant = areas['*'] ?? areas[areaSlug];
  return esAccesoValido(grant) ? grant : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Lectura de filas
// ════════════════════════════════════════════════════════════════════════════

const COLUMNAS =
  'tenant_id, area_slug, state, label, icon, blurb, tools, requirements, progress, unlocked_at, position';

function comoLista(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

async function leerFilas(ctx: TenantContext): Promise<TenantAreaRow[]> {
  const { data, error } = await tenantDb(ctx)
    .from('tenant_areas')
    .select(COLUMNAS)
    .order('position', { ascending: true })
    .limit(LIMITE_AREAS);

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo leer el mapa de áreas: ${error.message}`);
  }
  return (data ?? []) as unknown as TenantAreaRow[];
}

/**
 * Las filas del mapa, sembrando la primera vez.
 *
 * Criterio 1 del handoff: *"un tenant nuevo nace con sus áreas sembradas según
 * su giro"*. El §3 dice que quien crea el estado inicial es H7 (el Ritual), y
 * eso sigue siendo lo correcto — pero H7 no ha aterrizado, y un mapa vacío no
 * es un estado válido del producto: es una pantalla en blanco.
 *
 * Sembrar en la primera lectura resuelve las dos cosas a la vez. Es idempotente
 * (`areas_seed_tenant` no duplica ni pisa el avance), así que cuando H7 llame
 * a `POST /areas/seed` en el ritual, esto simplemente no encuentra nada que
 * hacer. No hay una segunda vía de creación: hay una sola función, llamada
 * desde dos lados.
 */
async function leerFilasSembrando(ctx: TenantContext): Promise<TenantAreaRow[]> {
  const filas = await leerFilas(ctx);
  if (filas.length > 0) return filas;

  await seedAreas(ctx);
  return leerFilas(ctx);
}

// ════════════════════════════════════════════════════════════════════════════
// Reconciliación
// ════════════════════════════════════════════════════════════════════════════

interface Reconciliada {
  row: TenantAreaRow;
  state: AreaState;
  progress: Progress;
  missing: string[];
  ratio: number;
  justUnlocked: boolean;
}

/**
 * Evalúa cada área contra las señales de ahora y persiste lo que cambió.
 *
 * Las escrituras van UNA POR ÁREA y no en lote a propósito: si el desbloqueo de
 * Servicio falla, el de Ventas ya quedó escrito. No son una transacción porque
 * no lo son en el negocio — son avances independientes, y agruparlos sólo haría
 * que un fallo cancelara logros que no tenían nada que ver.
 */
async function reconciliar(
  ctx: TenantContext,
  filas: TenantAreaRow[],
  signals: Signals,
): Promise<Reconciliada[]> {
  const salida: Reconciliada[] = [];

  for (const row of filas) {
    const progress = parseProgress(row.progress);
    const evaluacion = evaluate(row.requirements, signals, progress);
    const t = reconcile(row.state, evaluacion);

    if (t.changed) {
      await escribirEstado(ctx, row.area_slug, t.to, { marcarDesbloqueo: t.justUnlocked });
    }

    salida.push({
      row,
      state: t.to,
      progress,
      missing: evaluacion.missing,
      ratio: completionRatio(evaluacion),
      justUnlocked: t.justUnlocked,
    });
  }

  return salida;
}

async function escribirEstado(
  ctx: TenantContext,
  areaSlug: string,
  state: AreaState,
  opciones: { marcarDesbloqueo?: boolean } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { state };
  // `unlocked_at` se pone UNA vez, la primera. Es la fecha en que se lo ganó, y
  // reescribirla en cada transición borraría esa historia.
  if (opciones.marcarDesbloqueo) patch.unlocked_at = new Date().toISOString();

  const { error } = await tenantDb(ctx)
    .from('tenant_areas')
    .update(patch)
    .eq('area_slug', areaSlug);

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo actualizar el área ${areaSlug}: ${error.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Lo que se sirve
// ════════════════════════════════════════════════════════════════════════════

function aTarjeta(r: Reconciliada, ctx: TenantContext): AreaCard {
  const access = accessFor(ctx, r.row.area_slug);
  return {
    slug: r.row.area_slug,
    label: r.row.label || r.row.area_slug,
    icon: r.row.icon || 'wrench',
    position: r.row.position,
    state: r.state,
    access,
    blurb: r.row.blurb ?? '',
    tools: comoLista(r.row.tools),
    missing: r.missing,
    ratio: r.ratio,
    unlockedAt: r.row.unlocked_at,
    navigable: navegable(r.state, access),
  };
}

/** Las áreas sembradas, reconciliadas y ya en forma de tarjeta. */
async function cargarAreas(
  ctx: TenantContext,
): Promise<{ areas: AreaCard[]; signals: Signals; empty: boolean }> {
  const filas = await leerFilasSembrando(ctx);
  const signals = await readSignals(ctx);
  const reconciliadas = await reconciliar(ctx, filas, signals);

  return {
    areas: reconciliadas
      .map((r) => aTarjeta(r, ctx))
      .sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug)),
    signals,
    empty: filas.length === 0,
  };
}

/**
 * Lo que pinta el sidebar (`AreasPort.listAreas`).
 *
 * Devuelve TODAS las áreas, incluidas las bloqueadas: el criterio 3 del handoff
 * es que se vean con candado y su promesa. Filtrarlas aquí las escondería, y
 * esconderlas mata el motor del producto, que es la curiosidad.
 *
 * NO pasa por `loadMap()`, y la diferencia no es cosmética: esto corre en el
 * layout de CADA página del producto, y `loadMap` además lee el roadmap. Sería
 * una consulta de hitos por cada carga de cualquier pantalla, para pintar una
 * barra lateral que no enseña hitos.
 */
export async function listAreas(ctx: TenantContext): Promise<AreaSummary[]> {
  const { areas } = await cargarAreas(ctx);
  return areas.map(
    ({ missing: _m, ratio: _r, unlockedAt: _u, navigable: _n, ...resumen }) => resumen,
  );
}

/** Todo lo que el Mapa de Negocio necesita, de un viaje. */
export async function loadMap(ctx: TenantContext): Promise<BusinessMap> {
  const { areas, signals, empty } = await cargarAreas(ctx);
  return { areas, milestones: await listMilestones(ctx), signals, empty };
}

/** Una sola área, ya reconciliada. Para la pantalla del mini-onboarding. */
export async function getArea(ctx: TenantContext, areaSlug: string): Promise<AreaCard> {
  const { areas } = await cargarAreas(ctx);
  const area = areas.find((a) => a.slug === areaSlug);
  if (!area) throw new PlatformError('NOT_FOUND', `No existe el área "${areaSlug}" en tu mapa.`);
  return area;
}

// ════════════════════════════════════════════════════════════════════════════
// Las vías explícitas
// ════════════════════════════════════════════════════════════════════════════

/**
 * Siembra el mapa. Idempotente. La llama H7 al terminar el ritual, y también
 * la primera lectura si el mapa está vacío.
 */
export async function seedTenant(ctx: TenantContext): Promise<{ created: number }> {
  return { created: await seedAreas(ctx) };
}

/**
 * Abre un área a mano (`AreasPort.unlockArea`).
 *
 * Exige `admin` sobre el área: abrir un área cambia lo que la empresa entera
 * ve en su navegación, y eso no lo decide quien sólo tiene permiso de mirar.
 * El permiso se consulta con el mapa de H2 que ya viene en `ctx`.
 *
 * Es idempotente: pedir abrir lo ya abierto devuelve el estado y no falla —
 * quien la llama dos veces (un reintento, dos pestañas) no debería ver un error.
 */
export async function unlockArea(
  ctx: TenantContext,
  areaSlug: string,
): Promise<{ state: AreaState }> {
  const acceso = accessFor(ctx, areaSlug);
  if (acceso !== 'admin') {
    throw new PlatformError(
      'FORBIDDEN',
      `Abrir el área "${areaSlug}" requiere permiso de administración sobre ella.`,
    );
  }

  const fila = await unaFila(ctx, areaSlug);
  if (fila.state !== 'bloqueada') return { state: fila.state };

  await escribirEstado(ctx, areaSlug, 'disponible', { marcarDesbloqueo: true });
  return { state: 'disponible' };
}

/**
 * Vuelve a cerrar un área. La vía explícita que la reconciliación NO tiene.
 *
 * Existe porque el emprendedor puede haber abierto algo que no quería, o el
 * panel de agencia (H14) puede necesitar apagarle un área a un cliente. Lo que
 * NO existe es que se cierre sola por bajar de cinco contactos: ver
 * `domain/state.ts`.
 *
 * Se limpia `unlocked_at` con el cierre: si vuelve a abrirla, la fecha en que
 * se la ganó es la nueva, no una de hace tres meses que ya no significa nada.
 */
export async function lockArea(ctx: TenantContext, areaSlug: string): Promise<{ state: AreaState }> {
  if (accessFor(ctx, areaSlug) !== 'admin') {
    throw new PlatformError(
      'FORBIDDEN',
      `Cerrar el área "${areaSlug}" requiere permiso de administración sobre ella.`,
    );
  }

  await unaFila(ctx, areaSlug);

  const { error } = await tenantDb(ctx)
    .from('tenant_areas')
    .update({ state: 'bloqueada', unlocked_at: null })
    .eq('area_slug', areaSlug);

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo cerrar el área ${areaSlug}: ${error.message}`);
  }
  return { state: 'bloqueada' };
}

/**
 * El emprendedor declara algo de su negocio, y eso puede abrir un área.
 *
 * Es el requisito `{"type":"declared","key":"va_a_contratar"}`: ninguna tabla
 * puede contar si va a contratar. Sólo él lo sabe, y decirlo es el acto.
 *
 * Se escribe en `progress` y se reconcilia en el acto, para que el área se abra
 * en la misma petición: hacerlo esperar a la siguiente carga rompería la
 * relación de causa y efecto, que es todo lo que hace que esto se sienta un
 * juego y no un formulario.
 */
export async function declare(
  ctx: TenantContext,
  areaSlug: string,
  key: string,
  value = true,
): Promise<{ state: AreaState }> {
  const clave = String(key ?? '').trim();
  if (!clave) throw new PlatformError('VALIDATION', 'Falta la clave de la declaración.');

  if (accessFor(ctx, areaSlug) === null) {
    throw new PlatformError('FORBIDDEN', `Sin acceso al área "${areaSlug}".`);
  }

  const fila = await unaFila(ctx, areaSlug);
  const progress = parseProgress(fila.progress);
  progress.declared[clave] = value === true;

  const { error } = await tenantDb(ctx)
    .from('tenant_areas')
    .update({ progress })
    .eq('area_slug', areaSlug);

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo guardar la declaración: ${error.message}`);
  }

  // Reconciliar YA, con el dato recién escrito.
  const signals = await readSignals(ctx);
  const t = reconcile(fila.state, evaluate(fila.requirements, signals, progress));
  if (t.changed) {
    await escribirEstado(ctx, areaSlug, t.to, { marcarDesbloqueo: t.justUnlocked });
  }
  return { state: t.to };
}

/** Transiciones del mini-onboarding, que `services/onboarding.ts` orquesta. */
export async function marcarEnProgreso(ctx: TenantContext, areaSlug: string): Promise<AreaState> {
  const fila = await unaFila(ctx, areaSlug);
  const t = startOnboarding(fila.state);
  if (t.changed) await escribirEstado(ctx, areaSlug, t.to);
  return t.to;
}

export async function marcarActiva(ctx: TenantContext, areaSlug: string): Promise<AreaState> {
  const fila = await unaFila(ctx, areaSlug);
  const t = completeOnboarding(fila.state);
  if (t.changed) await escribirEstado(ctx, areaSlug, t.to);
  return t.to;
}

// ════════════════════════════════════════════════════════════════════════════
// Interno
// ════════════════════════════════════════════════════════════════════════════

/** Una fila del mapa de ESTA empresa, o 404. El aislamiento lo pone
 *  `tenantDb(ctx)`: el área de otro cliente no se encuentra. */
export async function unaFila(ctx: TenantContext, areaSlug: string): Promise<TenantAreaRow> {
  const { data, error } = await tenantDb(ctx)
    .from('tenant_areas')
    .select(COLUMNAS)
    .eq('area_slug', areaSlug)
    .maybeSingle();

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo leer el área ${areaSlug}: ${error.message}`);
  }
  if (!data) throw new PlatformError('NOT_FOUND', `No existe el área "${areaSlug}" en tu mapa.`);
  return data as unknown as TenantAreaRow;
}
