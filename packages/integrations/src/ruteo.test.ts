/**
 * ════════════════════════════════════════════════════════════════════════════
 *  RUTEO INVERSO: del webhook al dueño — criterio 10 de §11
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  H6 resuelve el tenant por la URL del webhook, y funciona porque cada canal
 *  tiene la suya. **Meta no funciona así**: una app de Meta tiene UN webhook
 *  para todas las páginas que la autorizaron, y el mensaje llega con el id de
 *  la página adentro. Hay que ir de ese id al tenant.
 *
 *  Y la parte que se olvida: **devolver `null` es una respuesta válida y
 *  frecuente**. Meta manda eventos de páginas que ya se desconectaron. `null`
 *  significa "ignora y registra", nunca "usa el primero que encuentres" — que
 *  es el atajo que le entregaría los mensajes de un negocio a otro.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capturarEntorno, limpiarEntorno } from './testing/entorno';
import { __setClientForTests } from '@abraxa/db';
import { createIntegrationsService } from './service';
import { LLAVE_DE_PRUEBA, contextoDePrueba, createFakeDb, type FakeDb } from './testing/fake-db';

const PANADERIA = contextoDePrueba('t-panaderia');
const INMOBILIARIA = contextoDePrueba('t-inmobiliaria');
let db: FakeDb;
let restaurarEntorno: () => void;

const fetchOk: typeof fetch = async () =>
  new Response(JSON.stringify({ id: 'no-importa' }), { status: 200 });

const servicio = () => createIntegrationsService({ fetchImpl: fetchOk });

beforeEach(() => {
  restaurarEntorno = capturarEntorno();
  limpiarEntorno();
  db = createFakeDb();
  __setClientForTests(db.client);
  process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
});

afterEach(() => {
  __setClientForTests(null);
  restaurarEntorno();
});

async function conectarPagina(ctx: typeof PANADERIA, pageId: string) {
  return servicio().save(ctx, {
    provider: 'meta',
    secret: `token-de-${pageId}`,
    externalAccountId: pageId,
    config: { pageId },
    verify: false,
  });
}

describe('del id de la cuenta externa al tenant dueño', () => {
  it('encuentra a la empresa correcta entre varias', async () => {
    await conectarPagina(PANADERIA, 'pagina-de-la-panaderia');
    const dela = await conectarPagina(INMOBILIARIA, 'pagina-de-la-inmobiliaria');

    const dueño = await servicio().resolveTenantByExternalAccount({
      provider: 'meta',
      externalAccountId: 'pagina-de-la-inmobiliaria',
    });

    expect(dueño).toEqual({
      tenantId: 't-inmobiliaria',
      integrationId: dela.integrationId,
    });
  });

  it('una cuenta desconocida devuelve null — nunca "el primero que haya"', async () => {
    await conectarPagina(PANADERIA, 'pagina-de-la-panaderia');

    const dueño = await servicio().resolveTenantByExternalAccount({
      provider: 'meta',
      externalAccountId: 'pagina-que-nadie-conectó',
    });

    expect(dueño).toBeNull();
  });

  it('no confunde proveedores: el mismo id en otro proveedor no cuenta', async () => {
    await conectarPagina(PANADERIA, 'cuenta-123');
    const dueño = await servicio().resolveTenantByExternalAccount({
      provider: 'twilio',
      externalAccountId: 'cuenta-123',
    });
    expect(dueño).toBeNull();
  });

  it('una integración revocada deja de rutear DE INMEDIATO', async () => {
    const conectada = await conectarPagina(PANADERIA, 'pagina-de-la-panaderia');
    expect(
      await servicio().resolveTenantByExternalAccount({
        provider: 'meta',
        externalAccountId: 'pagina-de-la-panaderia',
      }),
    ).not.toBeNull();

    await servicio().revoke(PANADERIA, conectada.integrationId);

    expect(
      await servicio().resolveTenantByExternalAccount({
        provider: 'meta',
        externalAccountId: 'pagina-de-la-panaderia',
      }),
    ).toBeNull();
  });

  it('una cuenta vacía o ausente devuelve null sin ir a la base', async () => {
    expect(
      await servicio().resolveTenantByExternalAccount({ provider: 'meta', externalAccountId: '' }),
    ).toBeNull();
  });

  it('deja rastro del webhook huérfano: "ignora y REGISTRA"', async () => {
    // Sin tenant no hay fila que escribir —`integration_events` está aislada
    // por tenant y aquí no se sabe cuál es—, así que el rastro va a la consola
    // del proceso. Lo que NO puede pasar es que el evento desaparezca sin
    // dejar nada: el día que a alguien no le lleguen sus mensajes, esta línea
    // es la que dice que llegaron y se ignoraron.
    const avisos: string[] = [];
    const original = console.warn;
    // El dato va como OBJETO en el segundo argumento, así que `String(x)` daría
    // '[object Object]' y la prueba pasaría por no mirar nada.
    console.warn = (...a: unknown[]) =>
      avisos.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    try {
      await servicio().resolveTenantByExternalAccount({
        provider: 'meta',
        externalAccountId: 'pagina-fantasma',
      });
    } finally {
      console.warn = original;
    }

    expect(avisos.join('\n')).toContain('pagina-fantasma');
    expect(avisos.join('\n')).toContain('meta');
  });
});
