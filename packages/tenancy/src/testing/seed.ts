/**
 * Siembra para las pruebas.
 *
 * Escribe DIRECTO en el almacén, sin pasar por los servicios que se están
 * probando. Es a propósito: si la prueba de aislamiento creara sus empresas
 * llamando a `provision()`, un bug en `provision()` podría dejarlas mal
 * sembradas y el test fallaría por la razón equivocada — o peor, pasaría por
 * la razón equivocada.
 */
import { __setClientForTests, type AnyClient } from '@abraxa/db';
import { AlmacenFake, type Fila } from './fake-postgrest';
import type { AreaAccess, MembershipRole, TenantStatus } from '../types';

export interface TenantSembrado {
  tenantId: string;
  slug: string;
  ownerEmail: string;
}

export interface SembrarTenantInput {
  slug: string;
  name?: string;
  ownerEmail: string;
  plan?: string;
  status?: TenantStatus;
}

/** Instala el doble como cliente de @abraxa/db. Devuelve cómo quitarlo. */
export function instalarDoble(): { almacen: AlmacenFake; restaurar: () => void } {
  const almacen = new AlmacenFake();
  const restaurar = __setClientForTests(almacen.cliente() as unknown as AnyClient);
  sembrarPlanes(almacen);
  return { almacen, restaurar };
}

/** Los mismos dos planes que siembra la migración 010. */
export function sembrarPlanes(almacen: AlmacenFake): void {
  almacen.sembrar('plans', [
    {
      id: 'free',
      name: 'Gratis',
      limits: { maxSeats: 2, maxContacts: 500, maxChannels: 1, maxFlows: 3, maxAgents: 1, monthlyAiUsd: 5 },
      position: 0,
    },
    {
      id: 'pro',
      name: 'Pro',
      limits: { maxSeats: 10, maxContacts: 10000, maxChannels: 3, maxFlows: 25, maxAgents: 5, monthlyAiUsd: 50 },
      position: 1,
    },
  ]);
}

/**
 * Una empresa completa: tenant + usuario dueño + membresía owner + grant `'*'`.
 * Es lo mismo que deja `app.provision_tenant()`.
 */
export function sembrarTenant(almacen: AlmacenFake, i: SembrarTenantInput): TenantSembrado {
  const email = i.ownerEmail.toLowerCase();

  const [tenant] = almacen.sembrar('tenants', {
    slug: i.slug,
    name: i.name ?? i.slug,
    plan: i.plan ?? 'free',
    status: i.status ?? 'active',
  });

  const tenantId = String((tenant as Fila).id);

  almacen.upsert('users', { email, name: null }, ['email']);
  almacen.sembrar('memberships', { tenant_id: tenantId, user_email: email, role: 'owner' });
  almacen.sembrar('area_grants', {
    tenant_id: tenantId,
    user_email: email,
    area_slug: '*',
    access: 'admin',
  });

  return { tenantId, slug: i.slug, ownerEmail: email };
}

/** Un miembro que no es el dueño, con sus áreas. */
export function sembrarMiembro(
  almacen: AlmacenFake,
  tenantId: string,
  email: string,
  role: MembershipRole,
  areas: Record<string, AreaAccess> = {},
): void {
  const correo = email.toLowerCase();
  almacen.upsert('users', { email: correo, name: null }, ['email']);
  almacen.upsert('memberships', { tenant_id: tenantId, user_email: correo, role }, [
    'tenant_id',
    'user_email',
  ]);
  for (const [area_slug, access] of Object.entries(areas)) {
    almacen.upsert('area_grants', { tenant_id: tenantId, user_email: correo, area_slug, access }, [
      'tenant_id',
      'user_email',
      'area_slug',
    ]);
  }
}
