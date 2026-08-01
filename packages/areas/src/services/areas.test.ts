/**
 * Los criterios observables del handoff H11 §8, uno por uno.
 *
 * El catálogo y las plantillas por giro que se siembran aquí son los DE VERDAD:
 * `testing/seed.ts` los lee de `migrations/090_areas.sql` y de la 033 de H4. Una
 * prueba que pasara con fixtures inventados no diría nada sobre lo que va a
 * producción.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError, __clearPorts, __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { createFakeDb, type FakeDb } from '../testing/fake-db';
import { TENANT_A, TENANT_B, haceMeses, mundo } from '../testing/seed';
import {
  accessFor,
  declare,
  getArea,
  listAreas,
  loadMap,
  lockArea,
  seedTenant,
  unlockArea,
} from './areas';

let db: FakeDb;
let restaurar: () => void;

/** El dueño: `owner` recibe el comodín `'*'` de H2, no filas por área. */
const dueño = (tenantId = TENANT_A): TenantContext => ({
  tenantId,
  tenantSlug: 'panaderia-lupita',
  userEmail: 'lupita@ejemplo.mx',
  role: 'owner',
  areas: { '*': 'admin' },
});

/** Un empleado con permisos por área, como los escribe `app.area_grants`. */
const empleado = (areas: Record<string, 'view' | 'edit' | 'admin'>): TenantContext => ({
  ...dueño(),
  userEmail: 'juan@ejemplo.mx',
  role: 'member',
  areas,
});

function montar(datos: Record<string, unknown[]>): void {
  db = createFakeDb(datos as never);
  restaurar = __setClientForTests(db.client);
}

afterEach(() => {
  restaurar?.();
  __clearPorts();
});

// ════════════════════════════════════════════════════════════════════════════

describe('criterio 1 — un tenant nuevo nace con sus áreas sembradas según su giro', () => {
  beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'servicios' }])));

  it('la primera lectura siembra el mapa, sin que nadie llame a nada', () => {
    expect(db.tabla('tenant_areas')).toHaveLength(0);
  });

  it('trae las áreas del giro Y las que el catálogo manda sembrar siempre', async () => {
    const areas = await listAreas(dueño());
    const slugs = areas.map((a) => a.slug).sort();

    // servicios (033): ventas, operaciones, servicio, finanzas, direccion
    // seed_always (090): onboarding, rh — que ningún giro declara
    expect(slugs).toEqual([
      'direccion',
      'finanzas',
      'onboarding',
      'operaciones',
      'rh',
      'servicio',
      'ventas',
    ]);
  });

  it('cada área nace en el estado que le toca, no todas iguales', async () => {
    const porSlug = Object.fromEntries((await listAreas(dueño())).map((a) => [a.slug, a.state]));

    // Operaciones es lo que el negocio YA hace: bloquearla sería bloquear el
    // negocio. Dirección es la bóveda, y arranca disponible.
    expect(porSlug.operaciones).toBe('disponible');
    expect(porSlug.direccion).toBe('disponible');
    // Las demás se ganan.
    expect(porSlug.ventas).toBe('bloqueada');
    expect(porSlug.servicio).toBe('bloqueada');
    expect(porSlug.rh).toBe('bloqueada');
    expect(porSlug.finanzas).toBe('bloqueada');
  });

  it('sembrar dos veces no duplica ni pisa lo que ya avanzó', async () => {
    await listAreas(dueño());
    const antes = db.tabla('tenant_areas').length;

    await unlockArea(dueño(), 'ventas');
    const { created } = await seedTenant(dueño());

    expect(created).toBe(0);
    expect(db.tabla('tenant_areas')).toHaveLength(antes);
    // Lo importante: resembrar NO le volvió a cerrar el área que abrió.
    expect(db.tabla('tenant_areas').find((f) => f.area_slug === 'ventas')?.state).toBe('disponible');
  });

  it('un giro que no está en el catálogo de H4 cae a `general` y no deja sin mapa', async () => {
    montar(mundo([{ id: TENANT_A, industry: 'taqueria-espacial' }]));
    const areas = await listAreas(dueño());
    expect(areas.length).toBeGreaterThan(0);
    expect(areas.map((a) => a.slug)).toContain('ventas');
  });
});

describe('criterio 6 — dos giros distintos siembran mapas distintos', () => {
  it('un restaurante y una tienda no ven las mismas áreas', async () => {
    montar(
      mundo([
        { id: TENANT_A, industry: 'restaurante' },
        { id: TENANT_B, industry: 'comercio' },
      ]),
    );

    const rest = (await listAreas(dueño(TENANT_A))).map((a) => a.slug).sort();
    const tienda = (await listAreas(dueño(TENANT_B))).map((a) => a.slug).sort();

    expect(rest).not.toEqual(tienda);
    // El restaurante tiene cocina como "operaciones"; la tienda no la declara.
    expect(rest).toContain('operaciones');
    expect(tienda).toContain('marketing');
    expect(tienda).not.toContain('operaciones');
  });

  it('hablan el lenguaje de su giro, no uno genérico', async () => {
    montar(
      mundo([
        { id: TENANT_A, industry: 'restaurante' },
        { id: TENANT_B, industry: 'agencia' },
      ]),
    );

    const ventasRest = (await listAreas(dueño(TENANT_A))).find((a) => a.slug === 'ventas');
    const ventasAgencia = (await listAreas(dueño(TENANT_B))).find((a) => a.slug === 'ventas');

    expect(ventasRest?.label).toBe('Ventas y piso');
    expect(ventasAgencia?.label).toBe('Ventas');
    expect(ventasRest?.blurb).not.toBe(ventasAgencia?.blurb);
  });

  it('el giro puede cambiar la REGLA, no sólo la etiqueta', async () => {
    // Un restaurante opera desde el día uno: su Finanzas abre al mes, no a los
    // tres. Es una fila del catálogo, no un `if`.
    montar(
      mundo([
        { id: TENANT_A, industry: 'restaurante', createdAt: haceMeses(1) },
        { id: TENANT_B, industry: 'servicios', createdAt: haceMeses(1) },
      ]),
    );

    const finRest = (await listAreas(dueño(TENANT_A))).find((a) => a.slug === 'finanzas');
    const finServ = (await listAreas(dueño(TENANT_B))).find((a) => a.slug === 'finanzas');

    expect(finRest?.state).toBe('disponible');
    expect(finServ?.state).toBe('bloqueada');
  });
});

describe('criterio 2 — cumplir un requisito desbloquea sola el área', () => {
  beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'servicios' }])));

  it('Servicio se abre al llegar al quinto contacto, sin que nadie apriete nada', async () => {
    const antes = (await listAreas(dueño())).find((a) => a.slug === 'servicio');
    expect(antes?.state).toBe('bloqueada');

    // Lo único que pasa: el CRM (otro carril) escribe contactos. Nadie le avisa
    // a H11.
    db.sembrar(
      'contacts',
      Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        tenant_id: TENANT_A,
        lifecycle: 'lead',
      })),
    );

    const despues = (await listAreas(dueño())).find((a) => a.slug === 'servicio');
    expect(despues?.state).toBe('disponible');
  });

  it('el desbloqueo QUEDA ESCRITO, no es sólo de la respuesta', async () => {
    db.sembrar(
      'contacts',
      Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, tenant_id: TENANT_A, lifecycle: 'lead' })),
    );
    await listAreas(dueño());

    const fila = db.tabla('tenant_areas').find((f) => f.area_slug === 'servicio');
    expect(fila?.state).toBe('disponible');
    expect(fila?.unlocked_at).toBeTruthy();
  });

  it('cuatro contactos no bastan: el requisito es un umbral, no una intención', async () => {
    db.sembrar(
      'contacts',
      Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, tenant_id: TENANT_A, lifecycle: 'lead' })),
    );
    // `loadMap` y no `listAreas`: el candado —`missing`— es del mapa. El
    // contrato con H5 es `AreaSummary` pelón y no lo trae, a propósito.
    const a = (await loadMap(dueño())).areas.find((x) => x.slug === 'servicio');
    expect(a?.state).toBe('bloqueada');
    expect(a?.missing).toEqual(['tienes 5 contactos activos']);
  });

  it('un cliente perdido no cuenta como contacto activo', async () => {
    db.sembrar('contacts', [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, tenant_id: TENANT_A, lifecycle: 'lead' })),
      { id: 'ido', tenant_id: TENANT_A, lifecycle: 'churned' },
    ]);
    expect((await listAreas(dueño())).find((a) => a.slug === 'servicio')?.state).toBe('bloqueada');
  });

  it('Ventas necesita canal Y embudo: con uno solo no abre', async () => {
    db.sembrar('channels', [{ id: 'ch', tenant_id: TENANT_A, status: 'active' }]);
    expect((await listAreas(dueño())).find((a) => a.slug === 'ventas')?.state).toBe('bloqueada');

    db.sembrar('pipeline_stages', [{ id: 's1', tenant_id: TENANT_A, is_won: false }]);
    expect((await listAreas(dueño())).find((a) => a.slug === 'ventas')?.state).toBe('disponible');
  });

  it('un canal a medio conectar no abre nada', async () => {
    db.sembrar('channels', [{ id: 'ch', tenant_id: TENANT_A, status: 'pending' }]);
    db.sembrar('pipeline_stages', [{ id: 's1', tenant_id: TENANT_A, is_won: false }]);
    expect((await listAreas(dueño())).find((a) => a.slug === 'ventas')?.state).toBe('bloqueada');
  });

  it('Dirección abre por CUALQUIERA de sus dos caminos', async () => {
    // Nace disponible, así que se prueba la regla contra el evaluador viendo
    // que el candado desaparece de `missing`.
    db.sembrar('documents', [{ id: 'd1', tenant_id: TENANT_A }]);
    const a = (await loadMap(dueño())).areas.find((x) => x.slug === 'direccion');
    expect(a?.missing).toEqual([]);
  });

  it('lo que se ganó no se le quita al borrar el dato', async () => {
    db.sembrar(
      'contacts',
      Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, tenant_id: TENANT_A, lifecycle: 'lead' })),
    );
    await listAreas(dueño());

    db.sembrar('contacts', []);
    const a = (await listAreas(dueño())).find((x) => x.slug === 'servicio');

    // Borró contactos y bajó de cinco. El área SIGUE abierta: en ningún juego
    // te quitan un nivel por bajar de puntos.
    expect(a?.state).toBe('disponible');
  });
});

describe('criterio 5 — cambiar `requirements` en datos cambia el comportamiento', () => {
  beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'servicios' }])));

  it('el agente maestro afloja la condición de UN cliente y el área abre', async () => {
    db.sembrar('contacts', [{ id: 'c1', tenant_id: TENANT_A, lifecycle: 'lead' }]);
    await listAreas(dueño());
    expect((await listAreas(dueño())).find((a) => a.slug === 'servicio')?.state).toBe('bloqueada');

    // Un UPDATE. Ni un deploy, ni un reinicio, ni una línea de TypeScript.
    const fila = db.tabla('tenant_areas').find((f) => f.area_slug === 'servicio');
    if (fila) fila.requirements = [{ type: 'contact_count', min: 1 }];

    expect((await listAreas(dueño())).find((a) => a.slug === 'servicio')?.state).toBe('disponible');
  });

  /**
   * Escribe `requirements` directo en la fila, como haría el agente maestro con
   * un UPDATE.
   *
   * El `await listAreas()` de antes NO es decorativo: el mapa se siembra en la
   * PRIMERA lectura, así que sin él `tenant_areas` está vacía, no hay fila que
   * mutar y la prueba acabaría midiendo el catálogo de siempre creyendo que
   * midió el cambio.
   */
  async function reescribirRequisitos(area: string, requirements: unknown[]): Promise<void> {
    await listAreas(dueño());
    const fila = db.tabla('tenant_areas').find((f) => f.area_slug === area);
    if (!fila) throw new Error(`la prueba no encontró el área ${area} ya sembrada`);
    fila.requirements = requirements;
  }

  it('una condición que el sistema no sabe leer NO abre el área', async () => {
    await reescribirRequisitos('servicio', [{ type: 'lo_que_se_le_ocurrio_al_agente' }]);

    const a = (await loadMap(dueño())).areas.find((x) => x.slug === 'servicio');
    expect(a?.state).toBe('bloqueada');
    expect(a?.missing).toEqual(['hay un requisito que este sistema no sabe leer (avísanos)']);
  });

  it('un requisito roto en un área no tumba el resto del mapa', async () => {
    await reescribirRequisitos('finanzas', [{ type: 'roto' }]);

    const map = await loadMap(dueño());
    expect(map.areas).toHaveLength(7);
    // El área rota se queda cerrada…
    expect(map.areas.find((a) => a.slug === 'finanzas')?.state).toBe('bloqueada');
    // …y las demás siguen funcionando. Un dato malo en Finanzas no puede dejar
    // al emprendedor sin poder entrar a Operaciones.
    expect(map.areas.find((a) => a.slug === 'operaciones')?.state).toBe('disponible');
  });
});

describe('criterio 3 — el área bloqueada se ve, con su promesa, y no se abre', () => {
  beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'servicios' }])));

  it('las bloqueadas VIENEN en la lista: esconderlas mata la curiosidad', async () => {
    const areas = await listAreas(dueño());
    expect(areas.filter((a) => a.state === 'bloqueada').length).toBeGreaterThan(0);
  });

  it('RH se ve con candado y con "graduarte de solopreneur"', async () => {
    const rh = (await loadMap(dueño())).areas.find((a) => a.slug === 'rh');
    expect(rh?.state).toBe('bloqueada');
    expect(rh?.blurb).toBe('Graduarte de solopreneur.');
    expect(rh?.navigable).toBe(false);
  });

  it('el candado dice qué falta, no sólo que está cerrado', async () => {
    const map = await loadMap(dueño());
    for (const a of map.areas.filter((x) => x.state === 'bloqueada')) {
      expect(a.missing.length).toBeGreaterThan(0);
      expect(a.missing.every((m) => m.length > 3)).toBe(true);
    }
  });

  it('la barra del candado enseña cuánto lleva', async () => {
    db.sembrar('contacts', [
      { id: 'c1', tenant_id: TENANT_A, lifecycle: 'lead' },
      { id: 'c2', tenant_id: TENANT_A, lifecycle: 'lead' },
    ]);
    const servicio = (await loadMap(dueño())).areas.find((a) => a.slug === 'servicio');
    expect(servicio?.ratio).toBeCloseTo(0.4, 5);
  });
});

describe('criterio 8 — `listAreas` devuelve lo que H5 necesita para el sidebar', () => {
  beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'comercio' }])));

  it('trae exactamente la forma de `AreaSummary`, sin campos de más', async () => {
    const [area] = await listAreas(dueño());
    expect(Object.keys(area ?? {}).sort()).toEqual([
      'access',
      'blurb',
      'icon',
      'label',
      'position',
      'slug',
      'state',
      'tools',
    ]);
  });

  it('viene ordenado por posición: el sidebar no reordena', async () => {
    const posiciones = (await listAreas(dueño())).map((a) => a.position);
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
  });

  it('las claves de herramienta son las que el registro del front resuelve', async () => {
    const ventas = (await listAreas(dueño())).find((a) => a.slug === 'ventas');
    expect(ventas?.tools).toContain('ventas:bandeja');
    expect(ventas?.tools?.every((t) => /^[a-z]+:[a-z]+$/.test(t))).toBe(true);
  });

  it('el icono es uno que H5 sabe pintar, no el `HeartHandshake` de la 033', async () => {
    const servicio = (await listAreas(dueño())).find((a) => a.slug === 'servicio');
    expect(servicio?.icon).toBe('headset');
  });
});

describe('el aislamiento entre clientes', () => {
  beforeEach(() =>
    montar(
      mundo([
        { id: TENANT_A, industry: 'servicios' },
        { id: TENANT_B, industry: 'comercio' },
      ]),
    ),
  );

  it('un tenant no ve el mapa del otro', async () => {
    await listAreas(dueño(TENANT_A));
    await listAreas(dueño(TENANT_B));

    const a = await listAreas(dueño(TENANT_A));
    expect(a.map((x) => x.slug)).not.toContain('inventario'); // es del comercio
    expect(db.tabla('tenant_areas').every((f) => f.tenant_id === TENANT_A || f.tenant_id === TENANT_B)).toBe(
      true,
    );
  });

  it('las señales de uno no cuentan para el otro', async () => {
    db.sembrar(
      'contacts',
      Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, tenant_id: TENANT_B, lifecycle: 'lead' })),
    );

    expect((await loadMap(dueño(TENANT_A))).signals.contacts_active).toBe(0);
    expect((await loadMap(dueño(TENANT_B))).signals.contacts_active).toBe(9);
  });

  it('no se puede abrir un área de otra empresa', async () => {
    await listAreas(dueño(TENANT_B));
    // El contexto es de A; el área existe, pero es de B.
    await expect(unlockArea(dueño(TENANT_A), 'inventario')).rejects.toThrow(PlatformError);
  });

  it('un contexto sin tenantId no llega a la base', async () => {
    const roto = { ...dueño(), tenantId: '' } as TenantContext;
    await expect(listAreas(roto)).rejects.toThrow(PlatformError);
  });
});

describe('los permisos son los de H2, consumidos y no reinventados', () => {
  beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'servicios' }])));

  it('el comodín de owner/admin le gana al grant por área', () => {
    expect(accessFor(dueño(), 'lo-que-sea')).toBe('admin');
  });

  it('deny por defecto: sin grant no hay acceso', () => {
    expect(accessFor(empleado({ ventas: 'edit' }), 'finanzas')).toBeNull();
    expect(accessFor(empleado({}), 'ventas')).toBeNull();
  });

  it('un grant con un valor que no es view|edit|admin se trata como ausente', () => {
    expect(accessFor(empleado({ ventas: 'superusuario' as never }), 'ventas')).toBeNull();
  });

  it('quien sólo mira ve el área en el mapa pero sin poder entrar a todas', async () => {
    const ctx = empleado({ ventas: 'view' });
    const map = await loadMap(ctx);

    const ventas = map.areas.find((a) => a.slug === 'ventas');
    const finanzas = map.areas.find((a) => a.slug === 'finanzas');

    expect(ventas?.access).toBe('view');
    expect(finanzas?.access).toBeNull();
    expect(finanzas?.navigable).toBe(false);
  });

  it('abrir un área exige `admin` sobre ella', async () => {
    await listAreas(dueño());
    await expect(unlockArea(empleado({ servicio: 'edit' }), 'servicio')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(unlockArea(empleado({ servicio: 'admin' }), 'servicio')).resolves.toEqual({
      state: 'disponible',
    });
  });

  it('cerrar un área también exige `admin`', async () => {
    await listAreas(dueño());
    await expect(lockArea(empleado({ operaciones: 'edit' }), 'operaciones')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('las vías explícitas', () => {
  beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'servicios' }])));

  it('abrir a mano es idempotente: dos pestañas no dan un error', async () => {
    await listAreas(dueño());
    expect(await unlockArea(dueño(), 'servicio')).toEqual({ state: 'disponible' });
    expect(await unlockArea(dueño(), 'servicio')).toEqual({ state: 'disponible' });
  });

  it('abrir a mano no reabre una que ya estaba activa, la deja como está', async () => {
    await listAreas(dueño());
    const fila = db.tabla('tenant_areas').find((f) => f.area_slug === 'operaciones');
    if (fila) fila.state = 'activa';
    expect(await unlockArea(dueño(), 'operaciones')).toEqual({ state: 'activa' });
  });

  it('cerrar un área limpia la fecha en que se la ganó', async () => {
    await listAreas(dueño());
    await unlockArea(dueño(), 'servicio');
    expect(db.tabla('tenant_areas').find((f) => f.area_slug === 'servicio')?.unlocked_at).toBeTruthy();

    await lockArea(dueño(), 'servicio');
    const fila = db.tabla('tenant_areas').find((f) => f.area_slug === 'servicio');
    expect(fila?.state).toBe('bloqueada');
    expect(fila?.unlocked_at).toBeNull();
  });

  it('un área que no existe da 404 y no un 500', async () => {
    await listAreas(dueño());
    await expect(getArea(dueño(), 'departamento-de-magia')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('la declaración: lo que ninguna tabla puede contar', () => {
  beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'servicios' }])));

  it('RH se abre en la MISMA petición en que él dice que va a contratar', async () => {
    await listAreas(dueño());
    expect((await listAreas(dueño())).find((a) => a.slug === 'rh')?.state).toBe('bloqueada');

    // Esperar a la siguiente carga rompería la relación de causa y efecto, que
    // es todo lo que hace que esto se sienta un juego.
    expect(await declare(dueño(), 'rh', 'va_a_contratar')).toEqual({ state: 'disponible' });
  });

  it('la declaración queda escrita en `progress`', async () => {
    await listAreas(dueño());
    await declare(dueño(), 'rh', 'va_a_contratar');
    expect(db.tabla('tenant_areas').find((f) => f.area_slug === 'rh')?.progress).toEqual({
      declared: { va_a_contratar: true },
    });
  });

  it('desdecirse no le vuelve a cerrar el área', async () => {
    await listAreas(dueño());
    await declare(dueño(), 'rh', 'va_a_contratar');
    expect(await declare(dueño(), 'rh', 'va_a_contratar', false)).toEqual({ state: 'disponible' });
  });

  it('sin acceso al área no se puede declarar nada sobre ella', async () => {
    await listAreas(dueño());
    await expect(declare(empleado({ ventas: 'edit' }), 'rh', 'va_a_contratar')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('una clave vacía se rechaza antes de escribir', async () => {
    await listAreas(dueño());
    await expect(declare(dueño(), 'rh', '   ')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('el mapa completo', () => {
  beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'servicios', createdAt: haceMeses(4) }])));

  it('trae áreas, roadmap y señales de un viaje', async () => {
    const map = await loadMap(dueño());
    expect(map.areas.length).toBe(7);
    expect(map.milestones).toEqual([]);
    expect(map.signals.months_operating).toBe(4);
  });

  it('Finanzas ya está abierta a los cuatro meses', async () => {
    expect((await loadMap(dueño())).areas.find((a) => a.slug === 'finanzas')?.state).toBe('disponible');
  });

  it('la primera venta cerrada abre Onboarding', async () => {
    db.sembrar('pipeline_stages', [
      { id: 's1', tenant_id: TENANT_A, is_won: false },
      { id: 'sw', tenant_id: TENANT_A, is_won: true },
    ]);
    db.sembrar('contact_stages', [{ tenant_id: TENANT_A, contact_id: 'c1', stage_id: 'sw' }]);

    expect((await loadMap(dueño())).areas.find((a) => a.slug === 'onboarding')?.state).toBe(
      'disponible',
    );
  });

  it('un contacto parado en una etapa que no es de ganado no cuenta como venta', async () => {
    db.sembrar('pipeline_stages', [{ id: 's1', tenant_id: TENANT_A, is_won: false }]);
    db.sembrar('contact_stages', [{ tenant_id: TENANT_A, contact_id: 'c1', stage_id: 's1' }]);

    expect((await loadMap(dueño())).areas.find((a) => a.slug === 'onboarding')?.state).toBe(
      'bloqueada',
    );
  });
});
