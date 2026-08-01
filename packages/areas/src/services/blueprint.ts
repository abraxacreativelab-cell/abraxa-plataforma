/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El `BlueprintSink` de H11 — lo que faltaba entre el Ritual y el panel
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── El hueco, medido ───────────────────────────────────────────────────────
 *
 *  Producción, 2026-08-01. Una empresa terminó el Ritual completo:
 *
 *      app.onboarding_blueprints   1 fila · 6 áreas · 2 hitos · applied_at NULL
 *      app.tenant_areas            0 filas
 *      app.tenant_milestones       0 filas
 *
 *  El invitado contestó 20 minutos de preguntas, el agente le narró su Mapa de
 *  Negocio… y el panel le salió genérico, porque no había una sola fila suya que
 *  leer. `applied_at` en NULL no era un error: era el sistema diciendo, con toda
 *  precisión, que nadie había registrado quién proyecta los blueprints.
 *
 *  ── Por qué le tocaba a este carril ────────────────────────────────────────
 *
 *  `packages/onboarding/src/ports/blueprint-sink.ts` lo deja escrito con nombre
 *  y apellido: H7 no podía escribir `tenant_areas` porque la tabla es de H11 y
 *  `AreasPort` (de H1) sólo declara LECTURA. Así que declaró el contrato en su
 *  carril, guardó la decisión íntegra, y dejó tres pasos anotados para H11:
 *
 *      1. implementar `BlueprintSink`      → `sink` aquí abajo
 *      2. registrarlo desde `src/index.ts` → `registrarSink()`
 *      3. correr el barrido de pendientes  → `proyectarBlueprint()`
 *
 *  Los tres están hechos en este archivo. Ni un archivo de H7 cambia.
 *
 *  ── El acoplamiento, y por qué es de UNA dirección y en tiempo de ejecución ─
 *
 *  `@abraxa/onboarding` NO está en las dependencias de este paquete y no se
 *  importa arriba. Se carga con un `import()` dinámico dentro de un `try`, igual
 *  que `(app)/layout.tsx` carga `next-auth`, y por las mismas dos razones:
 *
 *    · declararlo como dependencia obligaría a tocar `package-lock.json`, que es
 *      de H1 y cuyo desfase revienta el `npm ci` de CI para los catorce
 *      carriles;
 *    · si el módulo de H7 no está —una app que sólo monta el mapa, una prueba
 *      que carga este paquete suelto—, el mapa tiene que seguir funcionando con
 *      el catálogo del giro. Un carril que no aterrizó no puede tumbar otro.
 *
 *  El tipo del módulo se declara aquí, estructural: lo que cruza es JSON.
 */
// ── Por qué esta referencia, y por qué apunta al archivo de OTRO carril ──────
//
// Cargar `@abraxa/onboarding` mete sus fuentes en el programa de TypeScript de
// quien importe este paquete — y `apps/web` importa `@abraxa/areas` desde
// `/mapa`. H7 declara sus tablas en `packages/onboarding/src/tables.d.ts`, pero
// no lo referencia desde su `index.ts` (H9 y H11 sí lo hacen desde los suyos),
// así que el programa de `apps/web` llega a sus archivos siguiendo un import y
// NUNCA ve ese `.d.ts` suelto. Resultado medido: 8 errores de compilación en
// archivos de H7, provocados por un cambio de este carril.
//
// La salida honesta NO es redeclarar `onboarding_sessions` aquí —eso diría que
// esas tablas son de H11, y no lo son—. Es INCLUIR el archivo de H7 tal cual,
// que es lo que la referencia hace. No duplica una línea, no transfiere
// propiedad, y el día que H7 lo referencie desde su `index.ts` esto se vuelve
// un include repetido, que no cuesta nada. Se anota en el PR.
//
// La regla de ESLint pide un `import` en su lugar, y no aplica: un `.d.ts` no se
// puede importar sin renombrarlo a `.ts`.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../onboarding/src/tables.d.ts" />
import { PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import {
  type BlueprintDelRitual,
  type ReglaDeCatalogo,
  hitosQueFaltan,
  leerBlueprint,
  planDeProyeccion,
} from '../domain/blueprint';
import type { TenantAreaRow } from '../domain/types';
import { readCatalogRules, readIndustry, seedAreas } from '../data/rpc';
import { COLUMNAS_AREA, LIMITE_AREAS, LIMITE_HITOS } from '../data/tablas';

/** Quién aparece en `onboarding_blueprints.applied_by` y en los logs. */
export const NOMBRE_DEL_SINK = '@abraxa/areas';

// ════════════════════════════════════════════════════════════════════════════
// El puente con H7 — cargado en caliente, nunca importado arriba
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lo único que este paquete usa de `@abraxa/onboarding`. Declarado
 * estructuralmente: si H7 cambia algo de su interior, aquí sólo importa que
 * estas tres funciones sigan existiendo, y si no existen se degrada.
 */
interface PuenteDelRitual {
  registrarBlueprintSink: (sink: { nombre: string; aplicar: Aplicar } | null) => void;
  blueprintVigente: (ctx: TenantContext) => Promise<unknown>;
  aplicarBlueprint: (ctx: TenantContext, blueprint: unknown) => Promise<boolean>;
}

type Aplicar = (ctx: TenantContext, blueprint: unknown) => Promise<void>;

/**
 * El módulo de H7, o `null`. Se resuelve UNA vez, AL ARRANCAR, y se memoiza
 * —incluido el fallo—.
 *
 * ── El `import()` NO se dispara nunca desde una petición ───────────────────
 *
 * Sólo lo enciende `registrarSink()`, y a `registrarSink()` sólo lo llama
 * `src/index.ts`. O sea: cargar el paquete de H7 pasa una vez, al importar
 * `@abraxa/areas` —que es lo que hacen `apps/api` al arrancar y Next al
 * construir—, y nunca dentro del render de una página ni de una consulta.
 *
 * No es una micro-optimización: se midió. Con el `import()` colgando de la
 * lectura del mapa, la primera prueba que leía un mapa vacío pasó de 3 s a 67 s,
 * porque arrastraba el paquete entero del Ritual a transformarse en ese
 * instante. Lo que en una prueba son 67 s, en producción es la primera petición
 * de un usuario que estrena empresa — justo la que tiene que ser buena.
 *
 * `proyectarBlueprint()` sólo espera este promise si YA existe. Si nadie cargó
 * el puente (una prueba que importa `services/areas` suelto, una app que sólo
 * monta el mapa), devuelve `false` en el acto y el mapa se sirve del catálogo
 * del giro. Un carril que no está montado no puede costarle nada a otro.
 */
let puente: Promise<PuenteDelRitual | null> | null = null;

function cargarPuente(): Promise<PuenteDelRitual | null> {
  puente ??= (async () => {
    try {
      const mod = (await import('@abraxa/onboarding')) as unknown as Partial<PuenteDelRitual>;
      if (
        typeof mod.registrarBlueprintSink !== 'function' ||
        typeof mod.blueprintVigente !== 'function' ||
        typeof mod.aplicarBlueprint !== 'function'
      ) {
        return null;
      }
      return mod as PuenteDelRitual;
    } catch {
      // Falla CERRADO y en silencio: el mapa sigue sirviendo el catálogo del
      // giro, que es navegable. Lo que no puede pasar es que el Ritual de otro
      // carril tumbe esta pantalla.
      return null;
    }
  })();
  return puente;
}

/** `true` si alguien ya encendió el puente con H7. Para las pruebas. */
export function hayPuente(): boolean {
  return puente !== null;
}

/** Sólo para pruebas: vuelve a dejar el puente apagado. */
export function __olvidarPuenteParaPruebas(): void {
  puente = null;
}

// ════════════════════════════════════════════════════════════════════════════
// El sink
// ════════════════════════════════════════════════════════════════════════════

/**
 * Proyecta el blueprint a `tenant_areas` y `tenant_milestones`.
 *
 * ── IDEMPOTENTE, que es el requisito duro del contrato ─────────────────────
 *
 *  El barrido de recuperación de H7 lo va a llamar más de una vez sobre el mismo
 *  tenant y no puede dejar áreas ni hitos duplicados. Lo consigue así:
 *
 *    · las áreas tienen llave `(tenant_id, area_slug)` y aquí se decide INSERT o
 *      UPDATE leyendo antes lo que hay;
 *    · los estados no retroceden, así que reproyectar no le cierra a nadie un
 *      área que ya estaba usando;
 *    · los hitos se comparan por título normalizado, que es la única llave que
 *      existe: el blueprint no les pone id.
 *
 * ── El orden importa ───────────────────────────────────────────────────────
 *
 *  Primero se SIEMBRA desde el catálogo y luego se superpone el blueprint. Al
 *  revés no funciona: el blueprint no trae `tools` —el agente no sabe qué
 *  pantallas existen— y sin ellas la tarjeta del mapa no enlaza a ningún lado y
 *  el sidebar no lista una sola herramienta. La siembra pone la mecánica; el
 *  blueprint pone las palabras y el estado.
 */
export async function aplicarBlueprintDelRitual(
  ctx: TenantContext,
  crudo: unknown,
): Promise<{ areas: number; hitos: number }> {
  const blueprint = leerBlueprint(crudo);
  if (!blueprint) {
    throw new PlatformError('VALIDATION', 'El blueprint no tiene la forma esperada.');
  }

  // 1. El catálogo del giro. Idempotente: no pisa el avance de nadie.
  await seedAreas(ctx);

  // 2. Lo que ya hay, para decidir insertar o actualizar.
  const filas = await leerFilas(ctx);
  const reglas = await reglasDeCatalogo(ctx, blueprint);

  // 3. El plan, decidido por el dominio puro.
  const ahora = new Date().toISOString();
  const plan = planDeProyeccion(blueprint, filas, reglas, ahora).slice(0, LIMITE_AREAS);

  let areas = 0;
  for (const p of plan) {
    // Una por una y no en lote, igual que la reconciliación: si Servicio falla,
    // Ventas ya quedó escrita. Son avances independientes, no una transacción.
    if (Object.keys(p.patch).length === 0) continue;

    const { error } = p.nueva
      ? await tenantDb(ctx).from('tenant_areas').insert(p.patch)
      : await tenantDb(ctx).from('tenant_areas').update(p.patch).eq('area_slug', p.slug);

    if (error) {
      throw new PlatformError(
        'INTERNAL',
        `No se pudo proyectar el área ${p.slug} del Mapa de Negocio: ${error.message}`,
      );
    }
    areas += 1;
  }

  const hitos = await proyectarHitos(ctx, blueprint);
  return { areas, hitos };
}

/** El roadmap que el Ritual propuso, sin duplicar lo que ya está. */
async function proyectarHitos(ctx: TenantContext, blueprint: BlueprintDelRitual): Promise<number> {
  if (blueprint.hitos.length === 0) return 0;

  const { data, error } = await tenantDb(ctx)
    .from('tenant_milestones')
    .select('id, title, position')
    .order('position', { ascending: true })
    .limit(LIMITE_HITOS);

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo leer el roadmap: ${error.message}`);
  }

  const existentes = ((data ?? []) as unknown as Array<{ title: string; position: number }>).map(
    (h) => ({ title: String(h.title ?? ''), position: Number(h.position ?? 0) }),
  );

  const cupo = LIMITE_HITOS - existentes.length;
  if (cupo <= 0) return 0;

  const ultima = existentes.at(-1)?.position ?? 0;
  const nuevos = hitosQueFaltan(blueprint, existentes, ultima).slice(0, cupo);
  if (nuevos.length === 0) return 0;

  const { error: fallo } = await tenantDb(ctx)
    .from('tenant_milestones')
    .insert(nuevos.map((h) => ({ ...h })));
  if (fallo) {
    throw new PlatformError('INTERNAL', `No se pudo escribir el roadmap: ${fallo.message}`);
  }
  return nuevos.length;
}

async function leerFilas(ctx: TenantContext): Promise<TenantAreaRow[]> {
  const { data, error } = await tenantDb(ctx)
    .from('tenant_areas')
    .select(COLUMNAS_AREA)
    .limit(LIMITE_AREAS);

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo leer el mapa de áreas: ${error.message}`);
  }
  return (data ?? []) as unknown as TenantAreaRow[];
}

/**
 * Las reglas del catálogo para las áreas que menciona el blueprint.
 *
 * Sirven para dos cosas y las dos importan: darle `tools` e `icon` a un área que
 * la siembra no creó —el blueprint puede pedir Servicio para un giro cuya
 * plantilla no la trae—, y tener a qué caer cuando un requisito del agente no se
 * puede traducir.
 */
async function reglasDeCatalogo(
  ctx: TenantContext,
  blueprint: BlueprintDelRitual,
): Promise<Map<string, ReglaDeCatalogo>> {
  const slugs = blueprint.areas.map((a) => a.slug);
  if (slugs.length === 0) return new Map();

  // El giro del blueprint es el que el Ritual detectó; el del tenant es el que
  // se llegó a escribir. Se prefiere el primero: si `sembrarGiro` falló —y en
  // producción falló, `tenants.industry_type` está en NULL— el blueprint sigue
  // sabiendo a qué se dedica el negocio.
  const giro = blueprint.industryType ?? (await readIndustry(ctx));
  return readCatalogRules(slugs.slice(0, LIMITE_AREAS), giro);
}

// ════════════════════════════════════════════════════════════════════════════
// El registro y el barrido
// ════════════════════════════════════════════════════════════════════════════

/**
 * Registra este paquete como el sink de blueprints. Lo llama `src/index.ts` al
 * importarse, que es lo que hace `apps/api/src/packages.ts` al arrancar y lo que
 * hace `/mapa` al importar `@abraxa/areas`.
 *
 * Devuelve `true` si quedó registrado, para que una prueba lo pueda afirmar.
 */
export async function registrarSink(): Promise<boolean> {
  const mod = await cargarPuente();
  if (!mod) return false;

  mod.registrarBlueprintSink({
    nombre: NOMBRE_DEL_SINK,
    aplicar: async (ctx, blueprint) => {
      await aplicarBlueprintDelRitual(ctx, blueprint);
    },
  });
  return true;
}

/**
 * Proyecta el blueprint vigente de esta empresa, si lo hay.
 *
 * Es el paso 3 del handoff de H7 —*"correr `aplicarBlueprintsPendientes(ctx)`
 * una vez por tenant"*— resuelto sin un guion que alguien tenga que acordarse de
 * ejecutar: se llama solo la primera vez que el mapa está vacío. La empresa que
 * cerró su Ritual anoche, cuando no había sink, ve su mapa completo la próxima
 * vez que entre. Nadie la vuelve a entrevistar y nadie corre nada a mano.
 *
 * Se usa `aplicarBlueprint` (no `aplicarBlueprintsPendientes`) a propósito: el
 * barrido de H7 filtra por `applied_at IS NULL`, y esto también tiene que poder
 * REproyectar —después de un `POST /areas/seed`, que refresca las etiquetas
 * genéricas del catálogo encima de las palabras del agente—. La proyección es
 * idempotente, así que repetirla no cuesta nada más que la escritura.
 *
 * NUNCA lanza: `aplicarBlueprint` de H7 atrapa el fallo del sink, lo anota en
 * `apply_error` y devuelve `false`. Una pantalla no se cae porque un blueprint
 * no se pudo proyectar; se cae al catálogo del giro, que es navegable.
 *
 * @returns `true` si había blueprint y quedó proyectado.
 */
export async function proyectarBlueprint(ctx: TenantContext): Promise<boolean> {
  // Si nadie encendió el puente, aquí NO se enciende. Ver `cargarPuente()`.
  if (!puente) return false;

  const mod = await puente;
  if (!mod) return false;

  try {
    const blueprint = await mod.blueprintVigente(ctx);
    if (!blueprint) return false;
    return await mod.aplicarBlueprint(ctx, blueprint);
  } catch {
    return false;
  }
}
