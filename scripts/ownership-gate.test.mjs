import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { globToRegExp, perteneceA, duenosDe, revisarMigracion } from './ownership-gate.mjs';

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
  it('tiene las 14 entradas', () => {
    expect(Object.keys(ownership)).toHaveLength(14);
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
