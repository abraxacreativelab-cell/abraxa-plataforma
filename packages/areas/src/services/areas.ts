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
import { COLUMNAS_AREA, LIMITE_AREAS } from '../data/tablas';
import { proyectarBlueprint } from './blueprint';
import { listMilestones } from './milestones';

export { LIMITE_AREAS };

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

function comoLista(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

async function leerFilas(ctx: TenantContext): Promise<TenantAreaRow[]> {
  const { data, error } = await tenantDb(ctx)
    .from('tenant_areas')
    .select(COLUMNAS_AREA)
    .order('position', { ascending: true })
    .limit(LIMITE_AREAS);

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo leer el mapa de áreas: ${error.message}`);
  }
  return (data ?? []) as unknown as TenantAreaRow[];
}

/**
 * Las filas del mapa, creándolas la primera vez.
 *
 * Criterio 1 del handoff: *"un tenant nuevo nace con sus áreas sembradas según
 * su giro"*. Y hay DOS orígenes posibles para ese estado inicial, en este orden
 * de prioridad:
 *
 *  1. EL BLUEPRINT DEL RITUAL, si lo hay. Es el mapa que el agente decidió con
 *     los datos de SU negocio y le narró en el último turno: «Ventas y
 *     marketing», «Servicio y atención», con la promesa escrita para él. Ese es
 *     el pago de 20 minutos de preguntas y es lo que tiene que ver al llegar.
 *  2. EL CATÁLOGO DEL GIRO, si no. Un mapa genérico pero real, para quien
 *     todavía no ha hecho el Ritual.
 *
 * ── Por qué la proyección se dispara AQUÍ y no sólo al cerrar el Ritual ─────
 *
 * Porque al cerrar el Ritual también se dispara —`ritual.ts` llama a
 * `aplicarBlueprint`— y aun así no fue suficiente: la empresa que terminó su
 * Ritual el 2026-08-01 tenía el blueprint guardado con `applied_at` en NULL,
 * porque cuando cerró NO HABÍA SINK REGISTRADO. Un cierre que ocurre una sola
 * vez no puede ser la única oportunidad de proyectar; si lo fuera, esa empresa
 * se habría quedado con el panel genérico para siempre y la única salida sería
 * volver a entrevistar a su dueño.
 *
 * Con esto, se recupera sola la próxima vez que alguien de esa empresa entre a
 * cualquier pantalla del producto. Sin guiones que correr y sin avisarle a nadie.
 *
 * ── Y por qué no cuesta una consulta por carga ─────────────────────────────
 *
 * Porque sólo entra cuando el mapa está VACÍO. En cuanto hay una fila —o sea,
 * desde la segunda carga— este bloque no se ejecuta. `listAreas()` corre en el
 * layout de cada página del producto y no puede permitirse un viaje más.
 */
async function leerFilasSembrando(ctx: TenantContext): Promise<TenantAreaRow[]> {
  const filas = await leerFilas(ctx);
  if (filas.length > 0) return filas;

  // El mapa que el Ritual prometió. Si no hay Ritual —o si H7 no está montado—
  // devuelve `false` sin lanzar y se cae al catálogo del giro.
  if (!(await proyectarBlueprint(ctx))) await seedAreas(ctx);

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
  const tools = comoLista(r.row.tools);
  return {
    slug: r.row.area_slug,
    label: r.row.label || r.row.area_slug,
    icon: r.row.icon || 'wrench',
    position: r.row.position,
    state: r.state,
    access,
    blurb: r.row.blurb ?? '',
    tools,
    missing: r.missing,
    ratio: r.ratio,
    unlockedAt: r.row.unlocked_at,
    navigable: navegable(r.state, access),
    // Un área sin herramientas es un área cuya pantalla todavía no existe. Hoy
    // le pasa a Finanzas, Operaciones, RH, Onboarding, Inventario y Marketing:
    // seis de las nueve del catálogo de la 090.
    enConstruccion: tools.length === 0,
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
    ({
      missing: _m,
      ratio: _r,
      unlockedAt: _u,
      navigable: _n,
      enConstruccion: _c,
      ...resumen
    }) => resumen,
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
 *
 * ── Y REPROYECTA el blueprint después, que no es un detalle ────────────────
 *
 * `areas_seed_tenant` refresca desde el catálogo `label`, `blurb`, `tools` y
 * `position` de cada área que ya existe (su `ON CONFLICT DO UPDATE`), y eso es
 * correcto para la mecánica: así una herramienta nueva aparece sin migrar a
 * nadie. Pero pisa las PALABRAS: «Ventas y marketing», que el agente escribió
 * para este negocio, volvería a ser «Ventas».
 *
 * O sea que sembrar dos veces le degradaría el mapa al único cliente que hizo
 * el Ritual completo — en silencio, y sin que ninguna prueba de la siembra se
 * quejara. Volver a superponer el blueprint deja las dos cosas: la mecánica
 * fresca del catálogo y las palabras que se le prometieron.
 */
export async function seedTenant(ctx: TenantContext): Promise<{ created: number }> {
  const created = await seedAreas(ctx);
  await proyectarBlueprint(ctx);
  return { created };
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
    .select(COLUMNAS_AREA)
    .eq('area_slug', areaSlug)
    .maybeSingle();

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo leer el área ${areaSlug}: ${error.message}`);
  }
  if (!data) throw new PlatformError('NOT_FOUND', `No existe el área "${areaSlug}" en tu mapa.`);
  return data as unknown as TenantAreaRow;
}
