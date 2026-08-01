/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las semillas de las pruebas — leídas de las migraciones DE VERDAD
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El catálogo y las plantillas por giro que usan las pruebas NO están escritos
 *  a mano aquí: se parsean de `migrations/090_areas.sql` y de
 *  `migrations/033_industry_templates.sql`.
 *
 *  Es la diferencia entre probar que el motor funciona con datos inventados y
 *  probar que funciona con los datos que van a producción. El criterio 6 del
 *  handoff —*"dos giros distintos siembran mapas distintos"*— sólo significa
 *  algo si los giros son los reales: con fixtures a mano, la prueba pasaría
 *  aunque el catálogo sembrado estuviera vacío.
 *
 *  El riesgo de parsear —que un cambio de formato rompa los regex y las pruebas
 *  se pongan verdes sin verificar nada— lo cubre `domain/catalog.test.ts`, que
 *  falla si encuentra menos filas de las que debe haber.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Fila } from './fake-db';

const raiz = fileURLToPath(new URL('../../../../', import.meta.url));
const leer = (rel: string): string => readFileSync(raiz + rel, 'utf8');

// ════════════════════════════════════════════════════════════════════════════
// El catálogo de la 090
// ════════════════════════════════════════════════════════════════════════════

/**
 * La forma de UNA fila del `INSERT`, en el orden de sus columnas:
 *
 *   (industry_id, area_slug, icon, label, blurb, requirements, initial_state,
 *    tools, seed_always, script)
 *
 * Se ancla en la ESTRUCTURA entera y no en "todas las cadenas entrecomilladas".
 * La versión ingenua —recoger cada `'…'` y repartirlo por posición— se equivoca
 * en cuanto aparece un `'[…]'::jsonb`: al fallar el lookahead, el motor reintenta
 * desde la comilla de CIERRE del arreglo y acaba capturando `::jsonb,\n  ` como
 * si fuera un valor. Todo lo de después queda corrido un lugar, y las semillas
 * salen con la etiqueta y el estado cambiados sin que nada avise.
 */
const FILA =
  /\(\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'((?:[^']|'')*)',\s*'(\[[\s\S]*?\])'::jsonb,\s*'([^']*)',\s*'(\[[\s\S]*?\])'::jsonb,\s*(true|false)\s*,/;

/** Las filas de `app.area_catalog` tal como las siembra la migración. */
export function catalogoReal(): Fila[] {
  const sql = leer('migrations/090_areas.sql');
  const cuerpo = sql.split('INSERT INTO app.area_catalog')[1]?.split('ON CONFLICT')[0] ?? '';

  // Cada fila termina en `$s$::jsonb\n)`. Se corta ahí y se conserva el guion.
  const trozos = cuerpo.split(/\$s\$::jsonb\s*\n\s*\)/).slice(0, -1);

  return trozos.map((trozo, i) => {
    const guion = trozo.split('$s$')[1] ?? '{}';
    // Sin el guion, para que sus comillas no confundan al regex de la fila.
    const sinGuion = trozo.split('$s$')[0] ?? '';

    const m = FILA.exec(sinGuion);
    if (!m) throw new Error(`No se pudo leer la fila ${i} del catálogo de la 090`);

    return {
      industry_id: m[1],
      area_slug: m[2],
      icon: m[3],
      label: m[4],
      blurb: (m[5] as string).replace(/''/g, "'"),
      position: null,
      requirements: JSON.parse(m[6] as string) as unknown[],
      initial_state: m[7],
      tools: JSON.parse(m[8] as string) as unknown[],
      seed_always: m[9] === 'true',
      script: JSON.parse(guion) as unknown,
    } satisfies Fila;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Las plantillas por giro de la 033 (H4)
// ════════════════════════════════════════════════════════════════════════════

/** Las filas de `app.industry_templates`, con su lista de áreas. */
export function plantillasReales(): Fila[] {
  const sql = leer('migrations/033_industry_templates.sql');
  const filas: Fila[] = [];

  for (const m of sql.matchAll(/\(\s*\n\s*'([a-z]+)',[\s\S]*?\$json\$(\[[\s\S]*?\])\$json\$/g)) {
    filas.push({ id: m[1], areas: JSON.parse(m[2] as string) as unknown[] });
  }
  return filas;
}

// ════════════════════════════════════════════════════════════════════════════
// Un mundo listo para una prueba
// ════════════════════════════════════════════════════════════════════════════

export const TENANT_A = '00000000-0000-0000-0000-0000000000aa';
export const TENANT_B = '00000000-0000-0000-0000-0000000000bb';

/** Hace `meses` que la empresa existe. Para el requisito de Finanzas. */
export function haceMeses(meses: number): string {
  return new Date(Date.now() - meses * 2_592_000_000 - 60_000).toISOString();
}

/**
 * El mundo mínimo: el catálogo y las plantillas de verdad, más los tenants que
 * pida la prueba. Sin señales: un negocio recién nacido.
 */
export function mundo(
  tenants: Array<{ id: string; industry?: string; createdAt?: string }>,
): Record<string, Fila[]> {
  return {
    area_catalog: catalogoReal(),
    industry_templates: plantillasReales(),
    tenants: tenants.map((t) => ({
      id: t.id,
      slug: `t-${t.id.slice(-2)}`,
      name: `Empresa ${t.id.slice(-2)}`,
      industry_type: t.industry ?? 'general',
      created_at: t.createdAt ?? new Date().toISOString(),
    })),
  };
}
