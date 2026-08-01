/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Un cliente no ve los entitlements de otro. Criterio #12.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Lo que hace que esta prueba signifique algo es el doble: `AlmacenFake` guarda
 * las filas de TODAS las empresas juntas y **no filtra nada por su cuenta**
 * (`testing/fake-postgrest.ts:6-20`). Si una consulta de este subárbol se
 * olvidara de acotar por empresa, el doble le entregaría encantado las filas de
 * la otra y estas pruebas fallarían — que es exactamente lo que se quiere.
 *
 * Un doble "seguro" que escondiera las filas ajenas haría pasar todo esto
 * aunque el código estuviera mal, y estaríamos probando el doble.
 *
 * Aquí el filtro no se escribe a mano en ningún lado: todas las lecturas de
 * datos de empresa pasan por `tenantDb(ctx)`, que lo pone solo. Estas pruebas
 * verifican que eso sea cierto en la práctica y no sólo en la intención.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  instalarDoble,
  sembrarEfectivas,
  sembrarPausa,
  sembrarTenant,
  type AlmacenFake,
} from './testing/siembra';
import { contextFor } from '../services/context';
import { can, entitlementsFor, entitlementDetailsFor } from './can';
import { pausesFor, planHistoryFor } from './lifecycle';
import { overridesFor } from './overrides';
import type { FullTenantContext } from '../types';

let almacen: AlmacenFake;
let restaurar: () => void;

let panaderia: { tenantId: string };
let taqueria: { tenantId: string };
let ctxPanaderia: FullTenantContext;
let ctxTaqueria: FullTenantContext;

beforeEach(async () => {
  ({ almacen, restaurar } = instalarDoble());

  panaderia = sembrarTenant(almacen, {
    slug: 'panaderia-lupita',
    ownerEmail: 'ana@panaderia.mx',
    plan: 'free',
  });
  taqueria = sembrarTenant(almacen, {
    slug: 'taqueria-primo',
    ownerEmail: 'beto@taqueria.mx',
    plan: 'pro',
  });

  ctxPanaderia = await contextFor({ userEmail: 'ana@panaderia.mx', tenantSlug: 'panaderia-lupita' });
  ctxTaqueria = await contextFor({ userEmail: 'beto@taqueria.mx', tenantSlug: 'taqueria-primo' });
});

afterEach(() => {
  restaurar();
  almacen.limpiar();
});

describe('★ los entitlements de una empresa no se ven desde otra', () => {
  it('la panadería (free) no hereda lo que sí tiene la taquería (pro)', async () => {
    sembrarEfectivas(almacen, panaderia.tenantId, { 'inbox.whatsapp': true });
    sembrarEfectivas(almacen, taqueria.tenantId, {
      'inbox.whatsapp': true,
      'flows.publish': true,
      'crm.pipelines': true,
    });

    expect(await can(ctxPanaderia, 'flows.publish')).toBe(false);
    expect(await can(ctxTaqueria, 'flows.publish')).toBe(true);
  });

  it('el mapa completo trae SÓLO lo propio', async () => {
    sembrarEfectivas(almacen, panaderia.tenantId, { 'inbox.whatsapp': true });
    sembrarEfectivas(almacen, taqueria.tenantId, { 'crm.pipelines': true });

    const dePanaderia = await entitlementsFor(ctxPanaderia);
    expect(dePanaderia['crm.pipelines']).toBe(false);
    expect(dePanaderia['inbox.whatsapp']).toBe(true);

    // Y no vienen filas de más: exactamente una por función del catálogo.
    const detalle = await entitlementDetailsFor(ctxPanaderia);
    expect(new Set(detalle.map((d) => d.key)).size).toBe(detalle.length);
  });

  it('★ la nota de un trato especial ajeno no se filtra', async () => {
    // La nota puede decir "cortesía negociada con el cliente X a $Y" — es
    // información comercial de otra empresa.
    sembrarEfectivas(almacen, taqueria.tenantId, {
      'crm.pipelines': {
        granted: true,
        source: 'override',
        note: 'cortesía negociada en la venta, revisar en enero',
      },
    });
    sembrarEfectivas(almacen, panaderia.tenantId, {});

    const detalle = await entitlementDetailsFor(ctxPanaderia);
    expect(detalle.every((d) => d.note === null)).toBe(true);
  });
});

describe('★ las pausas tampoco cruzan', () => {
  it('cada empresa ve sólo las suyas', async () => {
    sembrarPausa(almacen, panaderia.tenantId, { feature: 'flows.publish', pausedBy: 'plan' });
    sembrarPausa(almacen, taqueria.tenantId, { feature: 'inbox.meta', pausedBy: 'user' });

    expect((await pausesFor(ctxPanaderia)).map((p) => p.featureKey)).toEqual(['flows.publish']);
    expect((await pausesFor(ctxTaqueria)).map((p) => p.featureKey)).toEqual(['inbox.meta']);
  });
});

describe('★ la bitácora de plan tampoco', () => {
  it('el historial de una no incluye los cambios de la otra', async () => {
    almacen.sembrar('plan_changes', [
      {
        id: 1,
        tenant_id: panaderia.tenantId,
        from_plan: 'pro',
        to_plan: 'free',
        from_status: 'active',
        to_status: 'active',
        reason: 'payment_failed',
        actor: null,
        effects: [],
        created_at: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 2,
        tenant_id: taqueria.tenantId,
        from_plan: 'free',
        to_plan: 'pro',
        from_status: 'active',
        to_status: 'active',
        reason: 'checkout',
        actor: 'beto@taqueria.mx',
        effects: [],
        created_at: '2026-07-02T00:00:00.000Z',
      },
    ]);

    expect((await planHistoryFor(ctxPanaderia)).map((h) => h.id)).toEqual([1]);
    expect((await planHistoryFor(ctxTaqueria)).map((h) => h.id)).toEqual([2]);
  });
});

describe('★ los tratos especiales tampoco', () => {
  it('overridesFor sólo devuelve los de la empresa del contexto', async () => {
    almacen.sembrar('tenant_entitlements', [
      {
        tenant_id: panaderia.tenantId,
        feature_key: 'crm.pipelines',
        granted: true,
        note: 'prueba de 14 dias del embudo',
        expires_at: null,
        updated_by: null,
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      {
        tenant_id: taqueria.tenantId,
        feature_key: 'inbox.sms',
        granted: false,
        note: 'quitado por abuso de mensajeria',
        expires_at: null,
        updated_by: null,
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    ]);

    expect((await overridesFor(ctxPanaderia)).map((o) => o.featureKey)).toEqual(['crm.pipelines']);
    expect((await overridesFor(ctxTaqueria)).map((o) => o.featureKey)).toEqual(['inbox.sms']);
  });
});
