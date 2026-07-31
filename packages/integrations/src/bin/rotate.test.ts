/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ROTAR LA LLAVE SIN APAGAR NADA — criterio 7 de §11
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Rotar sin versión obliga a un downtime o a un big-bang: hay que descifrar
 *  todo y volver a cifrarlo en una sola operación, con el sistema detenido, y
 *  si algo falla a la mitad queda la base partida en dos mundos.
 *
 *  Con `key_version` es aburrido, que es lo que uno quiere de una rotación:
 *
 *    1. Se agrega `INTEGRATIONS_KEY_2`. Lo nuevo se cifra con la 2.
 *    2. Lo viejo se sigue leyendo con la 1. Nadie nota nada.
 *    3. Este comando re-cifra por lotes, cuando dé la gana.
 *    4. Cuando ya no queda nada en la 1, se retira la llave 1.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capturarEntorno, limpiarEntorno } from '../testing/entorno';
import { __setClientForTests } from '@abraxa/db';
import { abrir } from '../crypto/secret-box';
import { deHex } from '../crypto/bytea';
import { createIntegrationsService } from '../service';
import { pendientesDeRotar, rotar } from './rotate';
import {
  LLAVE_DE_PRUEBA,
  LLAVE_DE_PRUEBA_2,
  contextoDePrueba,
  createFakeDb,
  type FakeDb,
} from '../testing/fake-db';

const PANADERIA = contextoDePrueba('t-panaderia');
const INMOBILIARIA = contextoDePrueba('t-inmobiliaria');
let db: FakeDb;
let restaurarEntorno: () => void;

const fetchOk: typeof fetch = async () =>
  new Response(JSON.stringify({ instance: { state: 'open' } }), { status: 200 });

beforeEach(async () => {
  restaurarEntorno = capturarEntorno();
  limpiarEntorno();
  db = createFakeDb();
  __setClientForTests(db.client);
  process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
  delete process.env.INTEGRATIONS_KEY_2;

  const svc = createIntegrationsService({ fetchImpl: fetchOk });
  await svc.save(PANADERIA, {
    provider: 'evolution',
    secret: 'secreto-de-la-panaderia',
    config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
    externalAccountId: 'panaderia',
  });
  await svc.save(INMOBILIARIA, {
    provider: 'evolution',
    secret: 'secreto-de-la-inmobiliaria',
    config: { baseUrl: 'https://evo.inmo.mx', instance: 'inmobiliaria' },
    externalAccountId: 'inmobiliaria',
  });
});

afterEach(() => {
  __setClientForTests(null);
  restaurarEntorno();
});

/** El secreto de una fila, descifrado a mano, como lo haría el proceso. */
function secretoDe(fila: Record<string, unknown>): string {
  return abrir(
    {
      ct: deHex(fila.secret_ct),
      iv: deHex(fila.secret_iv),
      tag: deHex(fila.secret_tag),
      version: Number(fila.key_version),
    },
    `${String(fila.tenant_id)}:${String(fila.provider)}`,
  );
}

describe('rotar por lotes, sin downtime', () => {
  it('lo viejo se sigue leyendo mientras lo nuevo ya usa la llave 2', async () => {
    process.env.INTEGRATIONS_KEY_2 = LLAVE_DE_PRUEBA_2;

    const svc = createIntegrationsService({ fetchImpl: fetchOk });
    // Una credencial nueva, ya con la llave 2.
    await svc.save(PANADERIA, {
      provider: 'resend',
      secret: 'secreto-nuevo',
      externalAccountId: 'panaderia.mx',
      verify: false,
    });

    // Y las dos viejas, en la 1, se resuelven igual. Sin apagar nada.
    const vieja = await svc.resolveFor(PANADERIA, 'evolution');
    expect(vieja.secret).toBe('secreto-de-la-panaderia');

    const versiones = db.tabla('tenant_integrations').map((f) => f.key_version);
    expect(versiones).toContain(1);
    expect(versiones).toContain(2);
  });

  it('re-cifra las filas atrasadas y deja los secretos intactos', async () => {
    process.env.INTEGRATIONS_KEY_2 = LLAVE_DE_PRUEBA_2;

    expect(await pendientesDeRotar()).toBe(2);

    const resumen = await rotar({ lote: 1 });
    expect(resumen.rotadas).toBe(2);
    expect(resumen.fallidas).toBe(0);
    expect(resumen.versionDestino).toBe(2);

    const filas = db.tabla('tenant_integrations');
    expect(filas.every((f) => f.key_version === 2)).toBe(true);
    expect(secretoDe(filas[0]!)).toBe('secreto-de-la-panaderia');
    expect(secretoDe(filas[1]!)).toBe('secreto-de-la-inmobiliaria');

    expect(await pendientesDeRotar()).toBe(0);
  });

  it('el servicio sigue resolviendo lo mismo después de rotar', async () => {
    process.env.INTEGRATIONS_KEY_2 = LLAVE_DE_PRUEBA_2;
    await rotar();

    const svc = createIntegrationsService({ fetchImpl: fetchOk });
    expect((await svc.resolveFor(PANADERIA, 'evolution')).secret).toBe('secreto-de-la-panaderia');
    expect((await svc.resolveFor(INMOBILIARIA, 'evolution')).secret).toBe(
      'secreto-de-la-inmobiliaria',
    );
  });

  it('sin llave nueva no hace nada — no es un no-op silencioso, lo dice', async () => {
    const resumen = await rotar();
    expect(resumen.rotadas).toBe(0);
    expect(resumen.versionDestino).toBe(1);
    expect(resumen.motivo).toMatch(/INTEGRATIONS_KEY_2|no hay una versión más alta/i);
  });

  it('correrlo dos veces es inofensivo', async () => {
    process.env.INTEGRATIONS_KEY_2 = LLAVE_DE_PRUEBA_2;
    await rotar();
    const segunda = await rotar();
    expect(segunda.rotadas).toBe(0);
    expect(segunda.fallidas).toBe(0);
  });

  it('una fila que no se puede descifrar se cuenta como fallida y NO se pisa', async () => {
    process.env.INTEGRATIONS_KEY_2 = LLAVE_DE_PRUEBA_2;

    const fila = db.tabla('tenant_integrations')[0]!;
    const original = String(fila.secret_ct);
    fila.secret_ct = '\\xdeadbeef'; // basura que ninguna llave abre

    const resumen = await rotar();
    expect(resumen.fallidas).toBe(1);
    expect(resumen.rotadas).toBe(1);

    // La fila rota se queda como estaba: rotar no destruye lo que no entiende.
    expect(String(db.tabla('tenant_integrations')[0]!.secret_ct)).toBe('\\xdeadbeef');
    expect(db.tabla('tenant_integrations')[0]!.key_version).toBe(1);
    expect(original).not.toBe('\\xdeadbeef');
  });

  it('la rotación queda en la bitácora de cada empresa', async () => {
    process.env.INTEGRATIONS_KEY_2 = LLAVE_DE_PRUEBA_2;
    await rotar();
    const eventos = db.tabla('integration_events').filter((e) => e.type === 'rotate');
    expect(eventos).toHaveLength(2);
    expect(new Set(eventos.map((e) => e.tenant_id))).toEqual(
      new Set(['t-panaderia', 't-inmobiliaria']),
    );
    // Ni el secreto ni la llave aparecen en el rastro.
    expect(JSON.stringify(eventos)).not.toContain('secreto-de-la-panaderia');
    expect(JSON.stringify(eventos)).not.toContain(LLAVE_DE_PRUEBA_2);
  });
});
