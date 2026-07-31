/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El dueño manda en SU bóveda — y sólo en la suya.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Regresión de un bug que estuvo VIVO en producción, no hipotético.
 *
 *  `hasArea()` leía `ctx.areas['direccion']` a secas. Pero H2 nunca le pone esa
 *  clave a un dueño: `loadAreaGrants()` (packages/tenancy/src/middleware/rbac.ts)
 *  ni siquiera consulta `area_grants` para dueños y administradores — devuelve
 *  `{ '*': 'admin' }` y ya. Resultado: la superficie de ESCRITURA entera de la
 *  bóveda respondía 403 al dueño de su propia empresa.
 *
 *  Medido contra la base real (empresa `prueba-rbac-dueno`) antes del arreglo:
 *
 *    GET  /tenants/current → "role":"owner","areas":{"*":"admin"}
 *    GET  /vault/values    → 200 {"values":[],"canEdit":false}
 *    POST /vault/values    → 403 "Necesitas acceso 'edit' al área direccion…"
 *    POST /vault/documents → 403 (mismo)
 *
 *  Por qué las pruebas viejas no lo vieron: el andamio arma los contextos con
 *  las cuatro áreas literales (`AREAS_TOTALES`), una forma que la producción
 *  jamás produce para un dueño. La prueba pasaba porque probaba otra cosa.
 *  Por eso aquí se usa `ctxDueno()`, que espeja lo que de verdad llega.
 *
 *  Las dos mitades van juntas a propósito. Dejar entrar al dueño es fácil; lo
 *  que hay que demostrar es que al hacerlo no se abrió la puerta de al lado.
 *  Cada «sí puede en la suya» de este archivo tiene su gemela «sigue sin poder
 *  en la ajena».
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { AreaAccess, TenantContext } from '@abraxa/db';
import { buscar } from './documents/search';
import {
  crearDocumento,
  editarDocumento,
  listarDocumentos,
  obtenerDocumento,
} from './documents/service';
import { AREA_BOVEDA, canEditVault, hasArea, requireVaultEdit, requireVaultRead } from './rbac';
import { ctxDe, ctxDueno, ctxSoloLectura, montar, valor, type Harness } from './testing/harness';
import {
  borrarValor,
  crearValor,
  editarValor,
  listarValores,
  obtenerValor,
} from './values/service';

/** Un contexto con exactamente el mapa de áreas que se le pase. */
const con = (areas: Record<string, AreaAccess>, tenantId: string): TenantContext =>
  ctxDe(tenantId, { role: 'owner', areas });

let h: Harness;

/** El dueño de A, tal como lo arma H2 en producción. */
let dueno: TenantContext;

const SECRETO = 777_777;

beforeEach(async () => {
  h = montar();
  dueno = ctxDueno(h.a.tenantId);

  // La empresa de al lado, con un dato inconfundible en cada superficie.
  h.db.sembrar('canonical_values', [
    valor(h.b.tenantId, {
      id: 'val-de-b',
      key: 'precio_confidencial',
      label: 'Precio confidencial',
      value: SECRETO,
    }),
  ]);
  await crearDocumento(h.b, {
    title: 'Estrategia confidencial de Despacho Ríos',
    content: 'Nuestro margen real es del 62% y el cliente ancla es Grupo Cortés.',
    docType: 'otro',
    areaSlug: 'direccion',
    status: 'active',
  });
});

afterEach(() => h.restaurar());

// ─── La mitad que estaba rota ────────────────────────────────────────────────

describe('el comodín que H2 le da al dueño', () => {
  it('`{ "*": "admin" }` concede edición en Dirección', () => {
    // Ésta es la línea exacta que fallaba: la clave literal no existe.
    expect(dueno.areas[AREA_BOVEDA]).toBeUndefined();
    expect(hasArea(dueno, AREA_BOVEDA, 'edit')).toBe(true);
    expect(canEditVault(dueno)).toBe(true);
    expect(() => requireVaultEdit(dueno)).not.toThrow();
    expect(() => requireVaultRead(dueno)).not.toThrow();
  });

  it('y también en cualquier otra área, que para eso es comodín', () => {
    for (const area of ['ventas', 'operaciones', 'finanzas', 'area-que-no-existe']) {
      expect(hasArea(dueno, area, 'admin')).toBe(true);
    }
  });
});

// ─── Y la mitad que NO se puede aflojar al arreglarla ────────────────────────

describe('el comodín no es una llave maestra', () => {
  it('un comodín de sólo lectura NO abre la escritura', () => {
    const mirón = con({ '*': 'view' }, h.a.tenantId);
    expect(hasArea(mirón, AREA_BOVEDA, 'view')).toBe(true);
    expect(hasArea(mirón, AREA_BOVEDA, 'edit')).toBe(false);
    expect(canEditVault(mirón)).toBe(false);
    expect(() => requireVaultEdit(mirón)).toThrow();
  });

  it('un comodín con basura adentro no concede NADA', () => {
    // Una fila malformada en `area_grants` no puede leerse como acceso total.
    const roto = con({ '*': 'dios' as AreaAccess }, h.a.tenantId);
    expect(hasArea(roto, AREA_BOVEDA, 'view')).toBe(false);
    expect(canEditVault(roto)).toBe(false);
    expect(() => requireVaultRead(roto)).toThrow();
  });

  it('sin ningún grant sigue siendo deny por defecto', () => {
    const nadie = con({}, h.a.tenantId);
    expect(hasArea(nadie, AREA_BOVEDA, 'view')).toBe(false);
    expect(canEditVault(nadie)).toBe(false);
    expect(() => requireVaultRead(nadie)).toThrow();
  });

  it('el grant por área explícito sigue mandando cuando no hay comodín', () => {
    const vendedor = ctxSoloLectura(h.a.tenantId);
    expect(() => requireVaultRead(vendedor)).not.toThrow();
    expect(canEditVault(vendedor)).toBe(false);
    expect(hasArea(vendedor, 'finanzas', 'view')).toBe(false);
  });

  it('se toma el MAYOR de los dos: ni el comodín degrada al área ni al revés', () => {
    expect(canEditVault(con({ '*': 'view', direccion: 'admin' }, h.a.tenantId))).toBe(true);
    expect(canEditVault(con({ '*': 'admin', direccion: 'view' }, h.a.tenantId))).toBe(true);
  });
});

// ─── Lo que el dueño SÍ puede hacer en su empresa ────────────────────────────

describe('el dueño escribe en su propia bóveda', () => {
  it('crea un valor canónico', async () => {
    const creado = await crearValor(dueno, {
      key: 'precio_hora',
      label: 'Precio por hora',
      kind: 'money',
      value: 1200,
      area_slug: 'direccion',
    });
    expect(creado.key).toBe('precio_hora');
    expect(await listarValores(dueno)).toHaveLength(1);
  });

  it('lo edita y lo borra', async () => {
    const creado = await crearValor(dueno, {
      key: 'ticket_promedio',
      label: 'Ticket promedio',
      kind: 'money',
      value: 250,
    });
    await expect(editarValor(dueno, creado.id, { value: 300 })).resolves.toMatchObject({
      value: 300,
    });
    await borrarValor(dueno, creado.id);
    expect(await listarValores(dueno)).toHaveLength(0);
  });

  it('crea y edita un documento', async () => {
    const doc = await crearDocumento(dueno, {
      title: 'Manual de la casa',
      content: 'Así se hace aquí.',
      docType: 'manual',
      areaSlug: 'direccion',
      status: 'active',
    });
    await expect(editarDocumento(dueno, doc.id, { content: 'Así se hace, versión dos.' })).resolves
      .toBeDefined();
    expect(await listarDocumentos(dueno)).toHaveLength(1);
  });
});

// ─── Y lo que sigue sin poder hacer en la de al lado ─────────────────────────

describe('el mismo dueño no toca la bóveda de otra empresa', () => {
  it('no ve los valores de B al listar', async () => {
    expect(await listarValores(dueno)).toHaveLength(0);
    expect(JSON.stringify(await listarValores(dueno))).not.toContain(String(SECRETO));
  });

  it('no lee un valor de B ni sabiendo su id', async () => {
    await expect(obtenerValor(dueno, 'val-de-b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('no edita un valor de B, y el de B queda intacto', async () => {
    await expect(editarValor(dueno, 'val-de-b', { value: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(obtenerValor(h.b, 'val-de-b')).resolves.toMatchObject({ value: SECRETO });
  });

  it('no borra un valor de B', async () => {
    await borrarValor(dueno, 'val-de-b');
    await expect(obtenerValor(h.b, 'val-de-b')).resolves.toMatchObject({ value: SECRETO });
  });

  it('no ve, abre ni edita documentos de B', async () => {
    const [doc] = await listarDocumentos(h.b);
    expect(doc).toBeDefined();
    expect(await listarDocumentos(dueno)).toHaveLength(0);
    await expect(obtenerDocumento(dueno, doc!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(editarDocumento(dueno, doc!.id, { content: 'pisado' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(obtenerDocumento(h.b, doc!.id)).resolves.toMatchObject({
      content: expect.stringContaining('Grupo Cortés') as unknown as string,
    });
  });

  it('no encuentra el documento de B ni buscando sus palabras exactas', async () => {
    expect((await buscar(dueno, 'Grupo Cortés margen')).hits).toHaveLength(0);
    // Control positivo: B sí lo encuentra. La prueba no pasa por estar rota.
    expect((await buscar(h.b, 'Grupo Cortés margen')).hits.length).toBeGreaterThan(0);
  });

  it('lo que el dueño de A escribe se queda en A', async () => {
    await crearValor(dueno, {
      key: 'margen_propio',
      label: 'Margen propio',
      kind: 'percent',
      value: 42,
    });
    expect((await listarValores(h.b)).map((v) => v.key)).not.toContain('margen_propio');
    expect((await listarValores(h.b)).map((v) => v.key)).toEqual(['precio_confidencial']);
  });
});
