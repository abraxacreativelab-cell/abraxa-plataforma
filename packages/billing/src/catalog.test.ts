/**
 * El catálogo vive en DOS lugares: `catalog.ts` (la decisión) y la siembra de
 * `migrations/080_billing.sql` (para que una base nueva arranque coherente).
 *
 * Dos copias de la misma verdad se separan. Aquí no: esta prueba lee el SQL de
 * verdad y lo compara contra el código.
 *
 * Importa más de lo que parece. `limits` es UNA columna jsonb, no un merge: si
 * el código y la migración discrepan, el que corra al final no "actualiza"
 * los límites — BORRA los que el otro tenía. `assertQuota()` de H2 compara
 * contra `maxChannels`, `maxFlows` y `maxAgents`, así que perderlos rompe su
 * motor de cuotas en silencio.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MONTO, PLAN_CATALOG, PLAN_DE_PAGO, PLAN_POR_DEFECTO, getPlan, isSellablePlan } from './catalog';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MIGRACION = join(AQUI, '..', '..', '..', 'migrations', '080_billing.sql');
const SQL = readFileSync(MIGRACION, 'utf8');

/** El CHECK de `app.plans.id` que escribió H2 en 010_tenancy.sql. */
const ID_VALIDO = /^[a-z][a-z0-9_]{1,30}$/;

describe('el catálogo v1', () => {
  it('vende exactamente free y pro — starter/agency son de H16', () => {
    expect(PLAN_CATALOG.map((p) => p.id)).toEqual(['free', 'pro']);
  });

  it('todos los ids pasan el CHECK de app.plans', () => {
    for (const p of PLAN_CATALOG) expect(ID_VALIDO.test(p.id)).toBe(true);
  });

  it('el plan por defecto y el de pago están en el catálogo y activos', () => {
    expect(isSellablePlan(PLAN_POR_DEFECTO)).toBe(true);
    expect(isSellablePlan(PLAN_DE_PAGO)).toBe(true);
  });

  it('no se vende un plan que no existe', () => {
    expect(isSellablePlan('agency')).toBe(false);
    expect(getPlan('starter')).toBeNull();
  });

  it('cada plan declara las seis llaves de límites que consume H2', () => {
    const llaves = ['maxSeats', 'maxContacts', 'maxChannels', 'maxFlows', 'maxAgents', 'monthlyAiUsd'];
    for (const p of PLAN_CATALOG) {
      expect(Object.keys(p.limits).sort()).toEqual([...llaves].sort());
    }
  });

  it('pro no es más chico que free en ningún límite', () => {
    const free = getPlan('free')!;
    const pro = getPlan('pro')!;
    for (const k of Object.keys(free.limits) as Array<keyof typeof free.limits>) {
      expect(pro.limits[k]).toBeGreaterThanOrEqual(free.limits[k]);
    }
  });
});

describe('el código y la migración 080 dicen lo mismo', () => {
  it.each([...PLAN_CATALOG])('el plan $id coincide con la siembra del SQL', (plan) => {
    // Se recorta el bloque de este plan dentro del INSERT y se leen sus
    // pares 'clave', valor de `jsonb_build_object`.
    const bloque = bloqueDelPlan(SQL, plan.id);
    expect(bloque, `no se encontró la siembra de '${plan.id}' en 080_billing.sql`).toBeTruthy();

    for (const [clave, valor] of Object.entries(plan.limits)) {
      const enSql = leerLimite(bloque!, clave);
      expect(enSql, `080_billing.sql no siembra '${clave}' para el plan ${plan.id}`).not.toBeNull();
      expect(enSql, `'${clave}' del plan ${plan.id} difiere entre catalog.ts y la migración`).toBe(
        valor,
      );
    }
  });

  it('la migración NO crea app.plans — es de H2', () => {
    expect(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.plans/i.test(SQL)).toBe(false);
  });

  it('la migración reconcilia el catálogo en vez de ceder', () => {
    // `DO NOTHING` dejaría los valores de H2 mandando y volvería mentira la
    // línea "H10 es dueño de la decisión".
    expect(/ON CONFLICT \(id\) DO UPDATE/i.test(SQL)).toBe(true);
  });
});

describe('los topes del monto libre', () => {
  it('el mínimo alcanza para que Stripe no rechace el cargo', () => {
    // El mínimo de Stripe para USD son 50 centavos.
    expect(MONTO.MINIMO_CENTAVOS).toBeGreaterThanOrEqual(50);
  });

  it('el preset cae dentro del rango', () => {
    expect(MONTO.PRESET_CENTAVOS).toBeGreaterThanOrEqual(MONTO.MINIMO_CENTAVOS);
    expect(MONTO.PRESET_CENTAVOS).toBeLessThanOrEqual(MONTO.MAXIMO_CENTAVOS);
  });
});

// ────────────────────────────────────────────────────────────────────────────

/** El trozo del INSERT que corresponde a un plan, hasta el cierre de su tupla. */
function bloqueDelPlan(sql: string, id: string): string | null {
  const i = sql.indexOf(`('${id}',`);
  if (i === -1) return null;
  const fin = sql.indexOf('),\n', i);
  return sql.slice(i, fin === -1 ? sql.indexOf(')', i) : fin);
}

/** Lee `'clave', 123` de un `jsonb_build_object`. */
function leerLimite(bloque: string, clave: string): number | null {
  const m = new RegExp(`'${clave}'\\s*,\\s*(\\d+)`).exec(bloque);
  return m ? Number(m[1]) : null;
}
