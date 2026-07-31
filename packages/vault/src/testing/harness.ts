/**
 * Andamio compartido de las pruebas: dos tenants, contextos con distintos
 * niveles de acceso, y el doble de base de datos ya enchufado.
 *
 * Dos tenants y no uno a propósito: el criterio que más importa de este
 * paquete es que el cliente A no pueda leer nada del B, y eso no se puede
 * probar con un solo tenant sembrado.
 */
import { __setClientForTests, type AnyClient, type TenantContext } from '@abraxa/db';
import { bumpVaultCache } from '../cache';
import { createFakeDb, resetFakeIds, type FakeDb } from './fake-db';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '22222222-2222-4222-8222-222222222222';

export const AREAS_TOTALES = {
  ventas: 'admin',
  operaciones: 'admin',
  finanzas: 'admin',
  direccion: 'admin',
} as const;

export function ctxDe(tenantId: string, over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId,
    tenantSlug: tenantId === TENANT_A ? 'empresa-a' : 'empresa-b',
    userEmail: tenantId === TENANT_A ? 'ana@empresa-a.mx' : 'beto@empresa-b.mx',
    role: 'owner',
    areas: { ...AREAS_TOTALES },
    ...over,
  };
}

/**
 * El dueño TAL COMO LLEGA EN PRODUCCIÓN, que no es como llega `ctxDe`.
 *
 * `loadAreaGrants()` de H2 (packages/tenancy/src/middleware/rbac.ts) ni siquiera
 * consulta `area_grants` para dueños y administradores: devuelve `{'*':'admin'}`
 * y punto. La clave literal `direccion` JAMÁS existe para ellos.
 *
 * `AREAS_TOTALES` —las cuatro áreas escritas a mano— es una forma cómoda para
 * las pruebas que la producción nunca produce. Esa comodidad escondió durante
 * todo un carril que la bóveda era de sólo lectura para su propio dueño. Lo que
 * se prueba con este contexto se prueba de verdad.
 */
export function ctxDueno(tenantId: string): TenantContext {
  return ctxDe(tenantId, { role: 'owner', areas: { '*': 'admin' } });
}

/** Alguien que puede ver la bóveda pero no tocarla. */
export function ctxSoloLectura(tenantId: string): TenantContext {
  return ctxDe(tenantId, { role: 'member', areas: { ventas: 'view', direccion: 'view' } });
}

export interface Harness {
  db: FakeDb;
  a: TenantContext;
  b: TenantContext;
  restaurar(): void;
}

const TENANTS = [
  {
    id: TENANT_A,
    slug: 'empresa-a',
    name: 'Taquería La Nueva',
    industry_type: 'restaurante',
    settings: {
      marca: { color: '#A85A3A', tono: 'cercano' },
      empresa: { rfc: 'XAXX010101000', ciudad: 'CDMX' },
      vault_aliases: { comision: 'valor.comision_pct' },
    },
  },
  {
    id: TENANT_B,
    slug: 'empresa-b',
    name: 'Despacho Ríos',
    industry_type: 'servicios',
    settings: {},
  },
];

/** El catálogo mínimo de giros. Espeja la forma que siembra la migración 033. */
const GIROS = [
  {
    id: 'general',
    name: 'Otro giro',
    blurb: 'Lo mínimo que todo negocio necesita tener claro.',
    position: 9,
    areas: [
      { slug: 'ventas', label: 'Ventas', icon: 'Target', position: 1, blurb: '' },
      { slug: 'operaciones', label: 'Operaciones', icon: 'Wrench', position: 2, blurb: '' },
      { slug: 'finanzas', label: 'Finanzas', icon: 'Wallet', position: 3, blurb: '' },
      { slug: 'direccion', label: 'Dirección', icon: 'Compass', position: 9, blurb: '' },
    ],
    expected_docs: [{ area_slug: 'ventas', doc_type: 'precios', title: 'Lista de precios' }],
    expected_values: [
      { area_slug: 'ventas', key: 'ticket_promedio', kind: 'money' },
      { area_slug: 'finanzas', key: 'iva_pct', kind: 'percent', hint: '16 en México' },
    ],
  },
  {
    id: 'restaurante',
    name: 'Restaurante y cafetería',
    blurb: 'Cocinas y vendes en el momento.',
    position: 3,
    areas: [
      { slug: 'ventas', label: 'Ventas y piso', icon: 'Store', position: 1, blurb: '' },
      { slug: 'operaciones', label: 'Cocina', icon: 'ChefHat', position: 2, blurb: '' },
      { slug: 'finanzas', label: 'Finanzas', icon: 'Wallet', position: 5, blurb: '' },
      { slug: 'direccion', label: 'Dirección', icon: 'Compass', position: 9, blurb: '' },
    ],
    expected_docs: [
      { area_slug: 'ventas', doc_type: 'precios', title: 'Menú con precios' },
      { area_slug: 'operaciones', doc_type: 'manual', title: 'Recetario' },
    ],
    expected_values: [
      { area_slug: 'ventas', key: 'ticket_promedio', kind: 'money' },
      { area_slug: 'operaciones', key: 'aforo', kind: 'number' },
      { area_slug: 'finanzas', key: 'iva_pct', kind: 'percent', hint: '16 en México' },
    ],
  },
  {
    id: 'servicios',
    name: 'Servicios profesionales',
    blurb: 'Cobras por tu trabajo.',
    position: 1,
    areas: [
      { slug: 'ventas', label: 'Ventas', icon: 'Target', position: 1, blurb: '' },
      { slug: 'direccion', label: 'Dirección', icon: 'Compass', position: 9, blurb: '' },
    ],
    expected_docs: [],
    expected_values: [{ area_slug: 'ventas', key: 'precio_hora', kind: 'money' }],
  },
];

/** Las llaves que, si estuvieran puestas, harían que una prueba saliera a la red. */
const LLAVES = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const;

/**
 * Prepara el mundo. Devuelve `restaurar()` para dejar todo como estaba —
 * el cliente es un singleton del proceso y la caché también.
 *
 * Apaga las llaves de IA a propósito: una prueba que sale a internet cuando la
 * corre quien tiene credenciales, y no cuando la corre CI, no es una prueba —
 * es una fuente de resultados distintos según la máquina. Quien de verdad
 * necesite el camino con modelo, que sustituya `fetch` explícitamente.
 */
export function montar(extra: Record<string, Record<string, unknown>[]> = {}): Harness {
  resetFakeIds();
  bumpVaultCache();

  const llavesPrevias = LLAVES.map((k) => [k, process.env[k]] as const);
  for (const k of LLAVES) delete process.env[k];

  const db = createFakeDb({
    tenants: TENANTS,
    industry_templates: GIROS,
    canonical_values: [],
    documents: [],
    document_versions: [],
    knowledge_chunks: [],
    ...extra,
  });

  const quitar = __setClientForTests(db as unknown as AnyClient);

  return {
    db,
    a: ctxDe(TENANT_A),
    b: ctxDe(TENANT_B),
    restaurar() {
      quitar();
      bumpVaultCache();
      for (const [k, v] of llavesPrevias) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

/**
 * El mundo con la base caída.
 *
 * No se simula con un mock de módulo a propósito: así se ejercita el camino
 * real —el que de verdad va a correr un martes a las 3 de la tarde— en vez de
 * una versión de laboratorio del fallo.
 */
export function montarCaido(modo: 'lanza' | 'error' = 'lanza'): { restaurar(): void } {
  bumpVaultCache();

  const cliente =
    modo === 'lanza'
      ? {
          from() {
            throw new Error('ECONNREFUSED: la base no contesta');
          },
          rpc() {
            throw new Error('ECONNREFUSED: la base no contesta');
          },
        }
      : {
          from: () => nuncaResuelveBien(),
          rpc: async () => ({ data: null, error: { message: 'timeout' } }),
        };

  const quitar = __setClientForTests(cliente as unknown as AnyClient);
  return {
    restaurar() {
      quitar();
      bumpVaultCache();
    },
  };
}

/** Un builder que siempre devuelve `{ data: null, error }`, como PostgREST caído. */
function nuncaResuelveBien(): Record<string, unknown> {
  const resultado = { data: null, error: { message: 'timeout' } };
  const self: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  };
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'in', 'order', 'limit', 'single', 'maybeSingle']) {
    self[m] = () => self;
  }
  return self;
}

/** Una fila de valor lista para sembrar, con los defaults de la 031. */
export function valor(tenantId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `v-${Math.random().toString(36).slice(2, 10)}`,
    tenant_id: tenantId,
    key: 'ticket_promedio',
    label: 'Ticket promedio',
    kind: 'money',
    value: 1500,
    value_text: null,
    value_json: null,
    currency: 'MXN',
    unit: null,
    note: null,
    area_slug: 'ventas',
    scope_type: 'tenant',
    scope_id: '',
    active: true,
    source_doc_id: null,
    position: 0,
    ...over,
  };
}
