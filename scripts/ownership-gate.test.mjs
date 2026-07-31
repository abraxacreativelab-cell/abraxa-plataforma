import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  globToRegExp,
  perteneceA,
  duenosDe,
  revisarMigracion,
  pathsEfectivos,
  excepcionVigente,
  carrilDeRama,
  CARRIL_ORQUESTADOR,
} from './ownership-gate.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ownership = JSON.parse(readFileSync(join(RAIZ, '.ownership.json'), 'utf8'));

describe('globToRegExp', () => {
  it('** cruza directorios', () => {
    expect(globToRegExp('packages/inbox/**').test('packages/inbox/src/a/b.ts')).toBe(true);
    expect(globToRegExp('packages/inbox/**').test('packages/vault/src/a.ts')).toBe(false);
  });

  it('* no cruza la diagonal', () => {
    expect(globToRegExp('packages/*/package.json').test('packages/vault/package.json')).toBe(true);
    expect(globToRegExp('packages/*/package.json').test('packages/vault/src/package.json')).toBe(
      false,
    );
  });

  it('escapa los paréntesis de los route groups de Next', () => {
    const re = globToRegExp('apps/web/app/(app)/bandeja/**');
    expect(re.test('apps/web/app/(app)/bandeja/page.tsx')).toBe(true);
    expect(re.test('apps/web/app/Xapp)/bandeja/page.tsx')).toBe(false);
  });

  it('**/ también casa con cero directorios', () => {
    expect(globToRegExp('apps/web/app/**/page.tsx').test('apps/web/app/page.tsx')).toBe(true);
  });
});

describe('perteneceA — exclusiones', () => {
  const h6 = ownership['h6-inbox'].paths;

  it('H6 es dueño de su paquete', () => {
    expect(perteneceA('packages/inbox/src/service.ts', h6)).toBe(true);
  });

  it('H6 NO es dueño de los drivers de H12 y H13', () => {
    expect(perteneceA('packages/inbox/src/drivers/meta/index.ts', h6)).toBe(false);
    expect(perteneceA('packages/inbox/src/drivers/email/index.ts', h6)).toBe(false);
    expect(perteneceA('packages/inbox/src/drivers/sms/index.ts', h6)).toBe(false);
  });

  it('pero sí del registro de drivers y del de WhatsApp', () => {
    expect(perteneceA('packages/inbox/src/drivers/registry.ts', h6)).toBe(true);
    expect(perteneceA('packages/inbox/src/drivers/whatsapp/index.ts', h6)).toBe(true);
  });

  /**
   * El mismo patrón, tres carriles después. H16 (entitlements) vive DENTRO del
   * paquete de H2 —lo que construye es la capa que quedó entre "el modelo, no
   * el cobro" de H2 y "el cobro" de H10— y H2 le cede su subárbol igual que H6
   * les cedió los drivers a H12 y H13.
   *
   * Sin estas dos exclusiones, H16 no puede escribir un solo archivo sin que el
   * gate lo atribuya a h2-tenancy, y H2 podría pisar el carril de H16 sin que
   * nada lo detenga.
   */
  it('H2 cede el subárbol de entitlements a H16, y sólo ése', () => {
    const h2 = ownership['h2-tenancy'].paths;
    const h16 = ownership['h16-entitlements'].paths;

    expect(perteneceA('packages/tenancy/src/services/plans.ts', h2)).toBe(true);
    expect(perteneceA('packages/tenancy/src/entitlements/can.ts', h2)).toBe(false);
    expect(perteneceA('packages/tenancy/entitlements/sql/seed.sql', h2)).toBe(false);

    expect(perteneceA('packages/tenancy/src/entitlements/can.ts', h16)).toBe(true);
    expect(perteneceA('packages/tenancy/entitlements/sql/seed.sql', h16)).toBe(true);
    // Y H16 no alcanza el resto del paquete de H2.
    expect(perteneceA('packages/tenancy/src/services/plans.ts', h16)).toBe(false);
    expect(perteneceA('packages/tenancy/src/middleware/tenant.ts', h16)).toBe(false);
  });

  /**
   * `/ajustes` se reparte entre tres carriles: la sección es de H18 (la hace
   * junto con la sesión), pero H16 necesita `plan` y H17 necesita
   * `integraciones` — la pantalla de conexión que H12-meta.md §2.4 le promete
   * al emprendedor ("vincula su cuenta desde Ajustes").
   */
  it('/ajustes se reparte: la sección es de H18, plan de H16 e integraciones de H17', () => {
    const h18 = ownership['h18-identidad'].paths;

    expect(perteneceA('apps/web/app/(app)/ajustes/page.tsx', h18)).toBe(true);
    expect(perteneceA('apps/web/app/(app)/ajustes/layout.tsx', h18)).toBe(true);
    expect(perteneceA('apps/web/app/(app)/ajustes/plan/page.tsx', h18)).toBe(false);
    expect(perteneceA('apps/web/app/(app)/ajustes/integraciones/page.tsx', h18)).toBe(false);

    expect(
      perteneceA('apps/web/app/(app)/ajustes/plan/page.tsx', ownership['h16-entitlements'].paths),
    ).toBe(true);
    expect(
      perteneceA(
        'apps/web/app/(app)/ajustes/integraciones/page.tsx',
        ownership['h17-integraciones'].paths,
      ),
    ).toBe(true);
  });

  /**
   * `apps/web/app/api/**` no era de nadie hasta que se emitió H18, y su
   * ausencia estaba anotada por H4 en
   * apps/web/app/(app)/direccion/_lib/session.ts. Un archivo sin dueño falla
   * `--check-overlap` y bloquea el PR de quien lo cree.
   */
  it('las rutas de servidor del front tienen dueño', () => {
    expect(duenosDe('apps/web/app/api/auth/[...nextauth]/route.ts', ownership)).toContain(
      'h18-identidad',
    );
    expect(duenosDe('apps/web/app/api/bff/[...path]/route.ts', ownership)).toContain(
      'h18-identidad',
    );
  });
});

describe('el mapa de propiedad', () => {
  /**
   * 14 carriles del plan original + H0 (el orquestador, alta del PR #15) + los
   * CUATRO emitidos el 2026-07-31 al encontrarse huecos que ninguno de los 14
   * podía cerrar desde su columna:
   *
   *   H15 (CRM) — el CRM se había dado por incluido dentro de H6 y H8, y
   *     ninguno de los dos lo construye: H6 declara `contact_id` SIN
   *     `REFERENCES` (H6-inbox.md:110) y H8 dice textualmente "no construyas
   *     el CRM" (H8-flows.md:38). Alta desde main, PR #15.
   *   H16 (entitlements) · H17 (integraciones por tenant) · H18 (identidad) —
   *     alta en este PR.
   *
   * Que sea un número escrito a mano es a propósito: abrir un carril nuevo
   * tiene que ser una decisión visible en un diff, no algo que pase solo. Se
   * actualiza al ALTA de un carril, y sólo entonces.
   */
  it('tiene las 14 entradas de construcción, más la de H0, más las cuatro emitidas después', () => {
    expect(Object.keys(ownership)).toHaveLength(19);
    expect(ownership[CARRIL_ORQUESTADOR]).toBeDefined();
    for (const carril of ['h15-crm', 'h16-entitlements', 'h17-integraciones', 'h18-identidad']) {
      expect(ownership[carril], carril).toBeDefined();
    }
  });

  /**
   * Los bloques de migración son disjuntos. Dos carriles con el mismo rango se
   * pisan el número el día que los dos escriban, y eso no lo detecta ningún
   * gate: lo detecta `migrate` en producción, tarde. Al alta de H15–H18 se
   * repartieron 120–129, 130–139, 140–149 y 150–159 justamente por esto.
   */
  it('ningún par de carriles comparte un número de migración', () => {
    const ocupado = new Map();
    for (const [nombre, cfg] of Object.entries(ownership)) {
      if (!cfg.migrations) continue;
      const [desde, hasta] = cfg.migrations;
      for (let n = desde; n <= hasta; n++) {
        expect(ocupado.get(n), `migración ${n}: ${ocupado.get(n)} y ${nombre}`).toBeUndefined();
        ocupado.set(n, nombre);
      }
    }
  });

  it('H0 no tiene bloque de migraciones: no las escribe, las ordena', () => {
    expect(ownership[CARRIL_ORQUESTADOR].migrations).toBeNull();
  });

  it('H0 no se solapa con ningún carril de construcción — h1-fundacion incluido', () => {
    // Hasta el 2026-07-31 este filtro excluía a h1-fundacion a mano, porque
    // `.ownership.json`, `scripts/**`, `eslint.config.mjs` y `CONTRIBUTING.md`
    // estaban en los dos lados. Ya no: salieron de H1 y `packages/db/**` trae
    // su exclusión de `src/http/**`. La nota de `.ownership.json` afirma que
    // el mapa es consistente SIN excepción; esto es lo que lo comprueba, y si
    // alguien reintroduce el solape, falla aquí en vez de en prosa.
    const construccion = Object.keys(ownership).filter((n) => n !== CARRIL_ORQUESTADOR);
    for (const glob of ownership[CARRIL_ORQUESTADOR].paths) {
      const muestra = glob.replace(/\*\*/g, 'x/y').replace(/\*/g, 'x');
      for (const carril of construccion) {
        expect(perteneceA(muestra, ownership[carril].paths), `${glob} vs ${carril}`).toBe(false);
      }
    }
  });

  it('cada entrada trae label y paths', () => {
    for (const [nombre, cfg] of Object.entries(ownership)) {
      expect(cfg.label, nombre).toBeTypeOf('string');
      expect(Array.isArray(cfg.paths), nombre).toBe(true);
      expect(cfg.paths.length, nombre).toBeGreaterThan(0);
    }
  });

  it('los bloques de migraciones no se traslapan', () => {
    const bloques = Object.entries(ownership)
      .filter(([, c]) => c.migrations)
      .map(([n, c]) => ({ n, lo: c.migrations[0], hi: c.migrations[1] }))
      .sort((a, b) => a.lo - b.lo);

    for (let i = 1; i < bloques.length; i++) {
      expect(bloques[i].lo, `${bloques[i].n} choca con ${bloques[i - 1].n}`).toBeGreaterThan(
        bloques[i - 1].hi,
      );
    }
  });

  /**
   * La regla sigue siendo "el lockfile no se toca". La lista es enumerada y no
   * un permiso general justamente para que agregarse a ella sea un cambio
   * visible que alguien tiene que aprobar.
   *
   * H15 está aquí por una razón mecánica: es el único carril que crea un
   * WORKSPACE nuevo (`packages/crm`), y `npm ci` se niega a instalar si el
   * lockfile no lo conoce ("Missing: @abraxa/crm@0.1.0 from lock file"). Sin
   * esa entrada, CI no llega ni a compilar.
   *
   * QUITAR `"lockfile": true` de h15-crm en cuanto el carril mergee.
   */
  it('el lockfile sólo lo mueven H1 y quien crea un workspace nuevo', () => {
    const conLockfile = Object.entries(ownership)
      .filter(([, c]) => c.lockfile === true)
      .map(([n]) => n);
    expect(conLockfile.sort()).toEqual(['h1-fundacion', 'h15-crm']);
  });

  /**
   * Las leyes del repo y el borde HTTP compartido tienen dueño ÚNICO — sin
   * apoyarse en que `verificarSolapamiento` excluye a h1-fundacion a mano.
   *
   * Un mapa que necesita una excepción para ser consistente no es un mapa
   * consistente: es uno que todavía no ha fallado.
   */
  it('las leyes del repo son de H0 y de nadie más', () => {
    for (const archivo of [
      '.ownership.json',
      'CONTRIBUTING.md',
      'eslint.config.mjs',
      'scripts/ownership-gate.mjs',
      'scripts/ownership-gate.test.mjs',
    ]) {
      expect(duenosDe(archivo, ownership), archivo).toEqual([CARRIL_ORQUESTADOR]);
    }
  });

  it('el borde HTTP compartido es de H0; el resto de packages/db sigue siendo de H1', () => {
    expect(duenosDe('packages/db/src/http/tenant-context.ts', ownership)).toEqual([
      CARRIL_ORQUESTADOR,
    ]);
    expect(duenosDe('packages/db/src/http/proxy-verified.ts', ownership)).toEqual([
      CARRIL_ORQUESTADOR,
    ]);
    expect(duenosDe('packages/db/src/tenant-db.ts', ownership)).toEqual(['h1-fundacion']);
    expect(duenosDe('packages/db/ports.ts', ownership)).toEqual(['h1-fundacion']);
  });

  it('un archivo ajeno se atribuye a su dueño real', () => {
    expect(duenosDe('packages/vault/src/resolver.ts', ownership)).toContain('h4-vault');
    expect(duenosDe('apps/web/app/(admin)/admin/page.tsx', ownership)).toContain('h14-admin');
  });
});

describe('excepcionTransversal — la única escotilla, y con candado', () => {
  const h0 = ownership[CARRIL_ORQUESTADOR];

  it('sólo H0 declara una', () => {
    const conExcepcion = Object.entries(ownership)
      .filter(([, c]) => c.excepcionTransversal)
      .map(([n]) => n);
    expect(conExcepcion).toEqual([CARRIL_ORQUESTADOR]);
  });

  it('viene con fecha, vencimiento, PR y razón escrita, no sólo con rutas', () => {
    const e = h0.excepcionTransversal;
    expect(e.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.venceEn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.venceEn > e.fecha, 'vence después de que se concede').toBe(true);
    expect(e.pr).toBeTypeOf('string');
    expect(e.razon.length).toBeGreaterThan(40);
    expect(e.paths.length).toBeGreaterThan(0);
  });

  it('la que está escrita hoy en el mapa sigue vigente', () => {
    // Si esto se pone rojo, la excepción caducó: retírala de .ownership.json.
    // No es una prueba frágil, es el recordatorio con dientes.
    expect(excepcionVigente(h0.excepcionTransversal).vigente).toBe(true);
  });

  it('es acotada: rutas explícitas, nunca el paquete entero de otro', () => {
    for (const p of h0.excepcionTransversal.paths) {
      expect(p, p).not.toMatch(/^packages\/[^/]+\/\*\*$/);
      expect(p, p).not.toMatch(/^apps\/[^/]+\/\*\*$/);
    }
  });

  it('H0 alcanza los archivos de la excepción, y sólo ésos', () => {
    const globs = pathsEfectivos(CARRIL_ORQUESTADOR, h0);
    expect(perteneceA('packages/agents/src/routes.ts', globs)).toBe(true);
    expect(perteneceA('packages/agents/src/http/proxy-verified.ts', globs)).toBe(true);
    expect(perteneceA('packages/vault/src/http/context.ts', globs)).toBe(true);
    expect(perteneceA('packages/tenancy/src/middleware/proxy.ts', globs)).toBe(true);
    // El resto de los árboles ajenos sigue cerrado para H0.
    expect(perteneceA('packages/agents/src/service.ts', globs)).toBe(false);
    expect(perteneceA('packages/vault/src/resolver.ts', globs)).toBe(false);
    expect(perteneceA('packages/tenancy/src/middleware/tenant.ts', globs)).toBe(false);
  });

  it('un carril de construcción NO puede concederse una', () => {
    const usurpador = {
      paths: ['packages/inbox/**'],
      excepcionTransversal: { paths: ['packages/vault/**'] },
    };
    expect(pathsEfectivos('h6-inbox', usurpador)).toEqual(['packages/inbox/**']);
    expect(perteneceA('packages/vault/src/resolver.ts', pathsEfectivos('h6-inbox', usurpador))).toBe(
      false,
    );
  });

  it('la excepción NO transfiere propiedad: el dueño real no cambia', () => {
    // Es lo que hace que `--check-overlap` siga siendo verdad.
    expect(duenosDe('packages/agents/src/routes.ts', ownership)).toEqual(['h3-agents']);
    expect(duenosDe('packages/vault/src/http/context.ts', ownership)).toEqual(['h4-vault']);
    expect(duenosDe('packages/tenancy/src/middleware/proxy.ts', ownership)).toEqual(['h2-tenancy']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// El candado #6: la excepción caduca sola.
//
// El PR #12 se concedió una excepción, la usó, mergeó — y la dejó escrita. Un
// permiso temporal que nadie retira es un permiso permanente, y "acuérdate de
// borrarlo" no es un mecanismo. Ahora lo es.
// ═════════════════════════════════════════════════════════════════════════════
describe('excepcionVigente — el permiso que se retira solo', () => {
  const HOY = new Date('2026-08-01T12:00:00Z');
  const viva = { venceEn: '2026-08-14', paths: ['packages/x/y.ts'] };

  it('vigente mientras no llegue su fecha', () => {
    expect(excepcionVigente(viva, HOY).vigente).toBe(true);
  });

  it('el último día todavía vale (vence AL final del día)', () => {
    expect(excepcionVigente({ ...viva, venceEn: '2026-08-01' }, HOY).vigente).toBe(true);
  });

  it('al día siguiente ya no', () => {
    const r = excepcionVigente({ ...viva, venceEn: '2026-07-31' }, HOY);
    expect(r.vigente).toBe(false);
    expect(r.motivo).toContain('venció');
  });

  it('sin `venceEn` no vale: falla CERRADO', () => {
    // El caso exacto del PR #12. Un permiso sin caducidad no se honra.
    const r = excepcionVigente({ paths: ['packages/x/y.ts'] }, HOY);
    expect(r.vigente).toBe(false);
    expect(r.motivo).toContain('venceEn');
  });

  it('sin excepción tampoco, y sin reventar', () => {
    expect(excepcionVigente(undefined, HOY).vigente).toBe(false);
    expect(excepcionVigente(null, HOY).vigente).toBe(false);
  });

  it('una excepción vencida NO amplía los paths de H0', () => {
    const cfg = {
      paths: ['docs/**'],
      excepcionTransversal: { venceEn: '2026-07-01', paths: ['packages/agents/src/routes.ts'] },
    };
    const globs = pathsEfectivos(CARRIL_ORQUESTADOR, cfg, HOY);
    expect(globs).toEqual(['docs/**']);
    expect(perteneceA('packages/agents/src/routes.ts', globs)).toBe(false);
  });

  it('una vigente sí, y sólo sobre sus rutas', () => {
    const cfg = {
      paths: ['docs/**'],
      excepcionTransversal: { venceEn: '2026-08-14', paths: ['packages/agents/src/routes.ts'] },
    };
    const globs = pathsEfectivos(CARRIL_ORQUESTADOR, cfg, HOY);
    expect(perteneceA('packages/agents/src/routes.ts', globs)).toBe(true);
    expect(perteneceA('packages/agents/src/service.ts', globs)).toBe(false);
  });
});

describe('revisarMigracion — la regla que GARDEN rompió 145 veces', () => {
  it('acepta una tabla con tenant_id y RLS', () => {
    const sql = `
CREATE TABLE app.threads (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id)
);
ALTER TABLE app.threads ENABLE ROW LEVEL SECURITY;`;
    expect(revisarMigracion(sql, '040_inbox.sql')).toEqual([]);
  });

  it('rechaza una tabla sin RLS', () => {
    const sql = `
CREATE TABLE app.threads (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
);`;
    const p = revisarMigracion(sql, '040_inbox.sql');
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('rechaza una tabla sin tenant_id', () => {
    const sql = `
CREATE TABLE app.cosas (
  id uuid PRIMARY KEY
);
ALTER TABLE app.cosas ENABLE ROW LEVEL SECURITY;`;
    const p = revisarMigracion(sql, '040_inbox.sql');
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('tenant_id');
  });

  it('acepta una tabla global declarada con -- tenantless:', () => {
    // El caso real de H10: billing_events llega ANTES de que exista el tenant.
    const sql = `
-- tenantless: los eventos de Stripe llegan antes de que el tenant exista.
CREATE TABLE app.billing_events (
  id bigserial PRIMARY KEY,
  stripe_event_id text UNIQUE NOT NULL
);
ALTER TABLE app.billing_events ENABLE ROW LEVEL SECURITY;`;
    expect(revisarMigracion(sql, '080_billing.sql')).toEqual([]);
  });

  it('la migración 001 pasa su propia regla', () => {
    const sql = readFileSync(join(RAIZ, 'migrations/001_foundation.sql'), 'utf8');
    expect(revisarMigracion(sql, '001_foundation.sql')).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Alias de rama. El gate exigía que la rama se llamara EXACTAMENTE igual que su
// entrada, y eso mata al segundo PR de cualquier carril que abra más de uno.
// H0 abre muchos: mergea, aplica migraciones, corrige handoffs y despliega.
// ═════════════════════════════════════════════════════════════════════════════
describe('carrilDeRama — alias de rama', () => {
  it('la rama que se llama igual que su entrada resuelve a sí misma', () => {
    for (const nombre of Object.keys(ownership)) {
      expect(carrilDeRama(nombre, ownership)).toBe(nombre);
    }
  });

  it('una rama declarada en `ramas` resuelve a su carril', () => {
    expect(carrilDeRama('h0-docs-ola2', ownership)).toBe(CARRIL_ORQUESTADOR);
  });

  it('una rama inventada no resuelve a nada', () => {
    expect(carrilDeRama('arreglito-rapido', ownership)).toBeNull();
    expect(carrilDeRama('h0', ownership)).toBeNull();
    expect(carrilDeRama('', ownership)).toBeNull();
  });

  it('todo alias declarado incluye el nombre de su propio carril', () => {
    for (const [nombre, cfg] of Object.entries(ownership)) {
      if (!cfg.ramas) continue;
      expect(Array.isArray(cfg.ramas), nombre).toBe(true);
      expect(cfg.ramas, nombre).toContain(nombre);
    }
  });

  it('ningún alias es reclamado por dos carriles', () => {
    const visto = new Map();
    for (const [nombre, cfg] of Object.entries(ownership)) {
      for (const r of cfg.ramas ?? []) {
        expect(visto.has(r) ? `${r} ya es de ${visto.get(r)}` : r, r).toBe(r);
        visto.set(r, nombre);
      }
    }
  });

  it('un alias NO reparte propiedad: los paths siguen siendo los del carril', () => {
    // La prueba de que el alias es inocuo para `--check-overlap`: el mapa de
    // dueños se calcula sobre `paths`, y `ramas` no aparece ahí.
    expect(duenosDe('docs/handoffs/H6-inbox.md', ownership)).toEqual([CARRIL_ORQUESTADOR]);
    expect(duenosDe('packages/vault/src/resolver.ts', ownership)).not.toContain(CARRIL_ORQUESTADOR);
  });
});
