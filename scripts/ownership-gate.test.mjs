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
});

describe('el mapa de propiedad', () => {
  it('tiene las 14 entradas de construcción más la de H0', () => {
    expect(Object.keys(ownership)).toHaveLength(15);
    expect(ownership[CARRIL_ORQUESTADOR]).toBeDefined();
  });

  it('H0 no tiene bloque de migraciones: no las escribe, las ordena', () => {
    expect(ownership[CARRIL_ORQUESTADOR].migrations).toBeNull();
  });

  it('H0 no se solapa con ningún carril de construcción', () => {
    // Con h1-fundacion sí, a propósito: ya mergeó y está dormido.
    const construccion = Object.keys(ownership).filter(
      (n) => n !== CARRIL_ORQUESTADOR && n !== 'h1-fundacion',
    );
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

  it('sólo H1 puede mover el lockfile', () => {
    const conLockfile = Object.entries(ownership).filter(([, c]) => c.lockfile === true);
    expect(conLockfile.map(([n]) => n)).toEqual(['h1-fundacion']);
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

  it('viene con fecha, PR y razón escrita, no sólo con rutas', () => {
    const e = h0.excepcionTransversal;
    expect(e.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.pr).toBeTypeOf('string');
    expect(e.razon.length).toBeGreaterThan(40);
    expect(e.paths.length).toBeGreaterThan(0);
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
    // El resto del árbol de H3 sigue cerrado para H0.
    expect(perteneceA('packages/agents/src/service.ts', globs)).toBe(false);
    expect(perteneceA('packages/vault/src/resolver.ts', globs)).toBe(false);
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
