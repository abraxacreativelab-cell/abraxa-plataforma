/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El catálogo de la 090, verificado contra los carriles con los que se casa
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Estas pruebas leen ARCHIVOS FUENTE en vez de importar código, y es a
 *  propósito. Lo que se verifica cruza tres carriles:
 *
 *    · el registro de iconos de H5 (`packages/ui/.../icon.tsx`)
 *    · las plantillas por giro de H4 (`migrations/033_industry_templates.sql`)
 *    · el catálogo de H11 (`migrations/090_areas.sql`)
 *
 *  `packages/areas` no depende de `@abraxa/ui` —es el paquete del navegador y
 *  H11 corre en el servidor—, así que importar `ICON_NAMES` no es una opción, y
 *  agregar la dependencia está prohibido por la regla 4 del contrato. Copiar la
 *  lista de iconos aquí la dejaría desactualizada en silencio el día que H5 la
 *  cambie, que es exactamente el fallo que esto viene a evitar.
 *
 *  Leer el fuente es lo mismo que hace `accent.test.ts` de H5 con los hex, y
 *  por la misma razón: la verdad está en el archivo, no en una copia.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { catalogoReal } from '../testing/seed';
import { parseRequirement } from './requirements';
import type { AreaScript } from './types';

const raiz = fileURLToPath(new URL('../../../../', import.meta.url));
const leer = (rel: string): string => readFileSync(raiz + rel, 'utf8');

const SQL_090 = leer('migrations/090_areas.sql');
const SQL_033 = leer('migrations/033_industry_templates.sql');
const ICON_TSX = leer('packages/ui/src/components/primitives/icon.tsx');

/**
 * El catálogo, leído con el MISMO parser que usan las semillas de las pruebas de
 * servicio. Verificarlo aquí es lo que permite que allá se confíe en él: si el
 * formato de la migración cambiara y el parser dejara de entenderlo, esto se
 * cae primero y con un mensaje claro, en vez de que las pruebas de servicio se
 * pongan verdes sembrando un catálogo vacío.
 */
const CATALOGO = catalogoReal();

// ── Lo que H5 sabe pintar ───────────────────────────────────────────────────

/**
 * Las claves del mapa `ICONOS` de H5. Se extraen del bloque literal para no
 * confundirlas con los `import` de lucide de arriba del archivo.
 */
function iconosDeH5(): Set<string> {
  const bloque = ICON_TSX.split('const ICONOS = {')[1]?.split('} satisfies')[0] ?? '';
  const claves = [...bloque.matchAll(/^\s*'?([a-z][a-z0-9-]*)'?\s*:/gim)]
    .map((m) => m[1])
    .filter((c): c is string => typeof c === 'string');
  return new Set(claves);
}

/** Los slugs de área que declara cada giro en la 033 (de H4). */
function areasPorGiro(): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  // Cada giro abre con `(\n  'id',` y su bloque de áreas es el primer $json$…$json$.
  for (const m of SQL_033.matchAll(/\(\s*\n\s*'([a-z]+)',[\s\S]*?\$json\$(\[[\s\S]*?\])\$json\$/g)) {
    const slugs = [...(m[2] as string).matchAll(/"slug"\s*:\s*"([a-z_]+)"/g)].map((x) => x[1] as string);
    mapa.set(m[1] as string, new Set(slugs));
  }
  return mapa;
}

// ════════════════════════════════════════════════════════════════════════════

describe('el catálogo se pudo leer', () => {
  it('encuentra las filas, con todas sus columnas', () => {
    // Si un cambio de formato rompiera el parser, las pruebas de abajo pasarían
    // en verde sin verificar nada. Esto lo impide.
    expect(CATALOGO.length).toBeGreaterThanOrEqual(9);
    expect(iconosDeH5().size).toBeGreaterThan(20);
    expect(areasPorGiro().size).toBe(5);

    // Y las columnas están en su lugar, no corridas: el fallo silencioso de un
    // parser posicional es leer bien el número de filas y mal su contenido.
    for (const f of CATALOGO) {
      expect(f.industry_id).toMatch(/^(\*|[a-z]+)$/);
      expect(f.area_slug).toMatch(/^[a-z_]+$/);
      expect(['bloqueada', 'disponible', 'en_progreso', 'activa']).toContain(f.initial_state);
      expect(Array.isArray(f.requirements)).toBe(true);
      expect(Array.isArray(f.tools)).toBe(true);
      expect(typeof f.seed_always).toBe('boolean');
      expect(String(f.blurb).length).toBeGreaterThan(10);
      expect(String(f.label).length).toBeGreaterThan(2);
    }
  });

  it('cada área trae etiqueta de respaldo, y ninguna sale de `initcap`', () => {
    // Sin `label`, la siembra cae a `initcap(area_slug)` y RH aparecería como
    // "Rh" en el sidebar y en el mapa. Las áreas que ningún giro declara son
    // justo las que dependen de este respaldo.
    for (const f of CATALOGO) {
      const et = String(f.label);
      expect(et).not.toBe(String(f.area_slug));
      expect(et[0]).toBe(et[0]?.toUpperCase());
    }
    expect(CATALOGO.find((f) => f.area_slug === 'rh')?.label).toBe('Recursos humanos');
  });
});

describe('cada icono del catálogo existe en el registro de H5', () => {
  it('ninguno cae al genérico de llave inglesa', () => {
    const conocidos = iconosDeH5();
    const rotos = CATALOGO.filter((f) => !conocidos.has(String(f.icon)));

    // La 033 de H4 escribe `HeartHandshake`, `ChefHat` y `Boxes`, que el
    // registro de H5 no tiene: servicio, cocina e inventario saldrían con una
    // llave inglesa. `area_catalog.icon` es lo que lo arregla, como DATO, sin
    // editar el árbol de H4 ni el de H5. Si alguien escribe aquí un icono que
    // H5 no conoce, esto se cae y se ve.
    expect(rotos.map((r) => `${String(r.industry_id)}/${String(r.area_slug)}: ${String(r.icon)}`)).toEqual(
      [],
    );
  });
});

describe('cada requisito sembrado lo sabe leer el evaluador', () => {
  it('ninguno queda como "no se entiende"', () => {
    // Un requisito ilegible deja el área cerrada para siempre. Sembrar uno sería
    // dejar un área muerta en producción sin que nada lo avise.
    const ilegibles: string[] = [];
    for (const f of CATALOGO) {
      for (const req of f.requirements as unknown[]) {
        if (parseRequirement(req) === null) {
          ilegibles.push(`${String(f.industry_id)}/${String(f.area_slug)}: ${JSON.stringify(req)}`);
        }
      }
    }
    expect(ilegibles).toEqual([]);
  });

  it('ninguna área se siembra sin reglas, que sería abrirse sola', () => {
    const sinReglas = CATALOGO.filter((f) => (f.requirements as unknown[]).length === 0);
    expect(sinReglas.map((f) => String(f.area_slug))).toEqual([]);
  });
});

describe('el catálogo cubre la tabla de desbloqueo del handoff §5', () => {
  const base = new Set(
    CATALOGO.filter((f) => f.industry_id === '*').map((f) => String(f.area_slug)),
  );

  it.each(['ventas', 'direccion', 'onboarding', 'servicio', 'rh', 'finanzas'])(
    'la regla base incluye %s',
    (area) => {
      expect(base.has(area)).toBe(true);
    },
  );

  it('cubre además las áreas que los giros de H4 sí declaran', () => {
    // Un área del giro sin fila en el catálogo se sembraría sin reglas y por
    // tanto disponible: se abriría sola sin que nadie hiciera nada.
    const declaradas = new Set([...areasPorGiro().values()].flatMap((s) => [...s]));
    const sinRegla = [...declaradas].filter((a) => !base.has(a));
    expect(sinRegla).toEqual([]);
  });

  it('un ajuste por giro sólo existe cuando de verdad cambia la regla', () => {
    // Una fila por área × giro sería el mismo hardcode de GARDEN en otra tabla.
    const porGiro = CATALOGO.filter((f) => f.industry_id !== '*');
    expect(porGiro.length).toBeLessThan(base.size);

    for (const f of porGiro) {
      const generica = CATALOGO.find(
        (g) => g.industry_id === '*' && g.area_slug === f.area_slug,
      );
      expect(generica).toBeTruthy();
      const distinta =
        JSON.stringify(f.requirements) !== JSON.stringify(generica?.requirements) ||
        f.initial_state !== generica?.initial_state ||
        f.blurb !== generica?.blurb;
      expect(distinta).toBe(true);
    }
  });
});

describe('las áreas que ningún giro declara se siembran igual', () => {
  it('Onboarding y RH llevan seed_always', () => {
    // Son de las que más curiosidad plantan y NINGÚN giro de la 033 las lista.
    // Sin `seed_always` la mitad de la tabla del handoff no se vería nunca.
    const declaradas = new Set([...areasPorGiro().values()].flatMap((s) => [...s]));
    expect(declaradas.has('onboarding')).toBe(false);
    expect(declaradas.has('rh')).toBe(false);

    for (const area of ['onboarding', 'rh']) {
      const fila = CATALOGO.find((f) => f.industry_id === '*' && f.area_slug === area);
      expect(fila?.seed_always).toBe(true);
    }
  });

  it('`seed_always` es la excepción, no el default', () => {
    // Marcarlas todas sembraría en cada empresa áreas que su giro decidió no
    // tener, y el criterio 6 —dos giros, dos mapas— dejaría de significar nada.
    const forzadas = CATALOGO.filter((f) => f.industry_id === '*' && f.seed_always);
    const base = CATALOGO.filter((f) => f.industry_id === '*');
    expect(forzadas.length).toBeLessThan(base.length / 2);

    // `ventas` es el caso claro de lo que NO se fuerza: la declaran los cinco
    // giros, y un giro nuevo tiene derecho a no tenerla.
    expect(CATALOGO.find((f) => f.industry_id === '*' && f.area_slug === 'ventas')?.seed_always).toBe(
      false,
    );

    // `direccion` sí se fuerza aunque hoy la declaren los cinco: es la bóveda,
    // y un giro nuevo que la olvide dejaría al negocio sin dónde guardar lo que
    // da por cierto.
    expect(
      CATALOGO.find((f) => f.industry_id === '*' && f.area_slug === 'direccion')?.seed_always,
    ).toBe(true);
  });
});

describe('cada guion trae lo que el handoff §6 pide', () => {
  it('intro, promesa, TRES preguntas y un primer resultado visible', () => {
    for (const f of CATALOGO) {
      const g = f.script as AreaScript;
      const donde = `${String(f.industry_id)}/${String(f.area_slug)}`;

      expect(typeof g.intro, donde).toBe('string');
      expect(g.intro.length, donde).toBeGreaterThan(20);
      expect(typeof g.promise, donde).toBe('string');
      expect(g.promise.length, donde).toBeGreaterThan(15);
      // Tres preguntas para configurarla — no veinte.
      expect(g.questions.length, donde).toBe(3);
      expect(new Set(g.questions.map((q) => q.key)).size, donde).toBe(3);
      // Un primer resultado visible antes de terminar.
      expect(g.result?.label, donde).toBeTruthy();
    }
  });

  it('las preguntas se le hacen al dueño del negocio, no a un usuario de software', () => {
    const preguntas = [...SQL_090.matchAll(/"prompt"\s*:\s*"([^"]+)"/g)].map((m) => m[1] as string);
    expect(preguntas.length).toBeGreaterThanOrEqual(27);

    // El handoff §6 es explícito: el tutorial es sobre SU negocio, no sobre la
    // herramienta. Una pregunta que nombra la interfaz ya se salió del guion.
    const jerga = /\b(campo|formulario|pestaña|men[úu]|bot[óo]n|dashboard|configuraci[óo]n)\b/i;
    expect(preguntas.filter((p) => jerga.test(p))).toEqual([]);
  });
});

describe('las promesas del handoff §5 están textuales', () => {
  it.each([
    ['ventas', 'Un equipo de ventas que nunca duerme'],
    ['direccion', 'Tus números en un solo lugar, para que nada más mienta'],
    ['onboarding', 'Cómo se siente entrar a tu negocio siendo cliente'],
    ['servicio', 'Dejar de perder clientes por no contestar'],
    ['rh', 'Graduarte de solopreneur'],
    ['finanzas', 'Saber si de verdad ganas'],
  ])('%s promete lo que el handoff dice', (_area, promesa) => {
    expect(SQL_090).toContain(promesa);
  });
});

describe('la migración cumple las reglas del repo', () => {
  it('las cuatro tablas llevan RLS en el mismo archivo que las crea', () => {
    const tablas = [...SQL_090.matchAll(/CREATE TABLE app\.([a-z_]+)/g)].map((m) => m[1] as string);
    expect(tablas.sort()).toEqual([
      'area_catalog',
      'area_onboarding_runs',
      'tenant_areas',
      'tenant_milestones',
    ]);

    for (const t of tablas) {
      expect(SQL_090).toContain(`ALTER TABLE app.${t} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it('la única tabla sin tenant_id se declara tenantless con su razón', () => {
    // `area_catalog` es catálogo de la plataforma, como app.industry_templates.
    const antes = SQL_090.split('CREATE TABLE app.area_catalog')[0] ?? '';
    expect(antes.slice(-400)).toMatch(/--\s*tenantless\s*:/i);
  });

  it('las funciones cuentan tablas de otros carriles con guard', () => {
    // La 120 (CRM) es POSTERIOR a la 090: en una base que va por la 090,
    // app.contacts todavía no existe. Sin el guard, el mapa entero revienta.
    for (const t of ['app.channels', 'app.contacts', 'app.pipeline_stages', 'app.canonical_values']) {
      expect(SQL_090).toContain(`to_regclass('${t}')`);
    }
  });

  it('la siembra no pisa el avance del cliente al reejecutarse', () => {
    const conflicto = SQL_090.split('ON CONFLICT (tenant_id, area_slug) DO UPDATE SET')[1] ?? '';
    const hasta = conflicto.split('RETURNING')[0] ?? '';
    for (const columna of ['state', 'progress', 'unlocked_at', 'requirements']) {
      expect(hasta).not.toMatch(new RegExp(`^\\s*${columna}\\s*=`, 'm'));
    }
  });
});
