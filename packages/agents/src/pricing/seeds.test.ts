/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La prueba que las migraciones decían tener y no existía.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La 021 escribía, en su encabezado: «un modelo sin precio NO se cobra a un
 *  número inventado: se marca `cost_source='unpriced'` con costo 0, se registra
 *  igual, y UNA PRUEBA DEL PAQUETE ROMPE EL BUILD». La 023 lo repetía en el
 *  COMMENT de `cost_source`.
 *
 *  Esa prueba no existía. `capabilities.test.ts` valida los campos internos del
 *  catálogo y nunca lo cruza con `model_pricing`; `bin/check-pricing.ts` sí lo
 *  detectaría pero necesita una base viva y no estaba cableado a ningún script.
 *  El resultado fue el hallazgo del 2026-07-31: `claude-sonnet-4-6` llevaba
 *  meses en el catálogo sin precio, y ponerlo en cualquier agente apagaba el
 *  tope de gasto de esa empresa.
 *
 *  Ésta es la prueba. Corre sin base y sin red, así que corre en CI —que es el
 *  único sitio donde un guardián sirve de algo—.
 *
 *  Las dos frases falsas siguen escritas en `migrations/021_model_pricing.sql`
 *  (encabezado) y en el `COMMENT ON` de `cost_source` de
 *  `migrations/023_usage_ledger.sql`, y NO se pueden borrar: las dos
 *  migraciones ya están aplicadas, y `scripts/migrate.mjs:88-98` aborta el
 *  despliegue completo si el checksum de una migración aplicada cambia. Los
 *  `COMMENT ON` de las migraciones 025 y 026 pisan ese texto en la base viva;
 *  el encabezado de la 025 deja la nota. Ver también `README.md`.
 *
 *  ── Qué se lee, y por qué las migraciones y no la base ─────────────────────
 *
 *  Las migraciones SON la fuente de verdad del esquema desplegado: lo que no
 *  esté sembrado aquí no está en producción. Leerlas en vez de consultar la
 *  base es lo que permite que esto falle en el PR, antes del despliegue, en
 *  lugar de después.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ProviderName } from '@abraxa/db';
import { modelosConocidos } from '../capabilities';
import { modeloPermitido } from '../providers/allowlist';
import { PRECIO_DE_PISO } from './compute';

const DIR_MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), '../../../../migrations');

interface FilaSembrada {
  provider: string;
  model: string;
  inputPerMtok: number;
  outputPerMtok: number;
  cacheWrite5mPerMtok: number;
  cacheWrite1hPerMtok: number;
  cacheReadPerMtok: number;
  effectiveFrom: string;
  archivo: string;
}

/**
 * Las filas de `app.model_pricing` sembradas por las migraciones.
 *
 * El parseo es a propósito tonto y estricto: reconoce la forma exacta en que se
 * escriben las semillas —una tupla por línea, con `DATE 'aaaa-mm-dd'`— y nada
 * más. Un parser de SQL de verdad aquí sería una pieza de infraestructura que
 * hay que mantener; un formato al que las semillas tienen que ceñirse es una
 * convención que se revisa en el PR. Si alguien escribe la semilla de otra
 * forma, esta prueba deja de verla y falla — que es el lado correcto en el que
 * equivocarse.
 */
function filasSembradas(dir = DIR_MIGRACIONES): FilaSembrada[] {
  const filas: FilaSembrada[] = [];
  const borradas = new Set<string>();

  for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, archivo), 'utf8');

    // Los DELETE se acumulan aparte y se aplican al final. Se leen en el mismo
    // barrido —y en orden— porque lo que importa no es lo que se sembró alguna
    // vez, sino lo que queda VIVO en la base: una semilla insertada por la 021
    // y borrada por la 028 no está en producción, y una prueba que la contara
    // estaría midiendo el archivo en vez del esquema.
    if (/DELETE\s+FROM\s+app\.model_pricing/i.test(sql)) {
      const tuplaBorrada = /\(\s*'(anthropic|openrouter|local)'\s*,\s*'([^']+)'\s*\)/gi;
      const bloque = sql.slice(sql.search(/DELETE\s+FROM\s+app\.model_pricing/i));
      for (const m of bloque.matchAll(tuplaBorrada)) borradas.add(`${m[1]}::${m[2]}`);
    }

    // Sólo los bloques que insertan en model_pricing.
    if (!/INSERT\s+INTO\s+app\.model_pricing/i.test(sql)) continue;

    const tupla =
      /\(\s*'(anthropic|openrouter|local)'\s*,\s*'([^']+)'\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*DATE\s+'(\d{4}-\d{2}-\d{2})'/gi;

    for (const m of sql.matchAll(tupla)) {
      filas.push({
        provider: m[1] as string,
        model: m[2] as string,
        inputPerMtok: Number(m[3]),
        outputPerMtok: Number(m[4]),
        cacheWrite5mPerMtok: Number(m[5]),
        cacheWrite1hPerMtok: Number(m[6]),
        cacheReadPerMtok: Number(m[7]),
        effectiveFrom: m[8] as string,
        archivo,
      });
    }
  }

  return filas.filter((f) => !borradas.has(`${f.provider}::${f.model}`));
}

describe('semillas de precio vs. catálogo de capacidades', () => {
  const filas = filasSembradas();

  it('el parseo encuentra las semillas (si no, todo lo demás es un falso verde)', () => {
    // Guardia del guardián: una prueba que no lee nada pasa siempre. Se
    // comprueban las tres cosas que el parser tiene que saber hacer, porque si
    // falla cualquiera de ellas el resto de la suite miente en verde.
    expect(filas.length).toBeGreaterThanOrEqual(8);
    // 1. lee los INSERT de la 021…
    expect(filas.some((f) => f.model === 'claude-opus-5')).toBe(true);
    // 2. …y también los de migraciones posteriores (la 025)…
    expect(filas.some((f) => f.model === 'claude-sonnet-4-6')).toBe(true);
    // 3. …y APLICA los DELETE (la 028), que es lo que hace que estas filas
    //    reflejen el esquema desplegado y no el historial de los archivos.
    expect(filas.some((f) => f.model === 'deepseek/deepseek-chat')).toBe(false);
  });

  it('TODO modelo del catálogo tiene precio sembrado para anthropic', () => {
    const conPrecio = new Set(
      filas.filter((f) => f.provider === 'anthropic').map((f) => f.model),
    );
    const sinPrecio = modelosConocidos().filter((m) => !conPrecio.has(m));

    // Éste es el hallazgo, convertido en freno. Antes de la migración 025 esta
    // línea falla con ['claude-sonnet-4-6'].
    expect(
      sinPrecio,
      `Estos modelos están en el CATALOGO de capabilities.ts y NO tienen fila de ` +
        `precio sembrada en migrations/. Su consumo se registraría como 'unpriced', ` +
        `y aunque el piso de compute.ts impide que el tope se quede ciego, un modelo ` +
        `que decimos conocer tiene que tener su precio de verdad: service.ts rechaza ` +
        `la corrida con VALIDATION. Siembra la fila en una migración nueva.`,
    ).toEqual([]);
  });

  it('cada modelo del catálogo tiene una fila VIGENTE hoy, no sólo una futura', () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const vigentes = new Set(
      filas
        .filter((f) => f.provider === 'anthropic' && f.effectiveFrom <= hoy)
        .map((f) => f.model),
    );

    // Un precio que entra en vigor el mes que viene no evita que la corrida de
    // hoy caiga en 'unpriced'. La 021 siembra dos filas de Sonnet 5 justo por
    // esto: la introductoria arranca en 2026-01-01, no en septiembre.
    expect(modelosConocidos().filter((m) => !vigentes.has(m))).toEqual([]);
  });

  it('NINGUNA semilla viva queda fuera de la lista blanca de proveedores', () => {
    // Sembrar un precio es afirmar que ese proveedor está autorizado a procesar
    // conversaciones de clientes. Ésa es la afirmación que hizo parecer
    // soportados a DeepSeek y Google: eran los únicos modelos no-Anthropic
    // nombrados en todo el repositorio, sembrados con precio, y el propio
    // paquete los citaba como razón para dejar pasar ids no-Anthropic.
    //
    // Con las semillas de la 021 y sin el DELETE de la 028, esta línea falla
    // con ['openrouter/deepseek/deepseek-chat', 'openrouter/google/gemini-2.5-flash'].
    const fuera = filas
      .filter((f) => !modeloPermitido(f.model, f.provider as ProviderName))
      .map((f) => `${f.provider}/${f.model}`);

    expect(
      fuera,
      `Estas semillas de app.model_pricing están fuera de la lista blanca de ` +
        `providers/allowlist.ts. Un precio sembrado hace parecer soportado a un ` +
        `proveedor, y cada proveedor abierto hay que declararlo en el tratamiento ` +
        `de datos. Bórralas en una migración nueva o abre la lista a propósito.`,
    ).toEqual([]);
  });

  it('el precio de piso sigue siendo el MÁS CARO de lo sembrado', () => {
    // Si algún día se siembra algo más caro que Fable 5, el piso deja de ser un
    // piso y el tope vuelve a poder quedarse corto. Esta prueba obliga a
    // subirlo en el mismo PR que introduce el modelo caro.
    const masCaroInput = Math.max(...filas.map((f) => f.inputPerMtok));
    const masCaroOutput = Math.max(...filas.map((f) => f.outputPerMtok));

    expect(PRECIO_DE_PISO.inputPerMtok).toBeGreaterThanOrEqual(masCaroInput);
    expect(PRECIO_DE_PISO.outputPerMtok).toBeGreaterThanOrEqual(masCaroOutput);
  });

  it('ninguna semilla se contradice: mismo (provider, model, fecha) una sola vez', () => {
    // Es el UNIQUE de la 021. Dos filas iguales con precios distintos harían que
    // el costo dependiera del orden de lectura.
    const vistas = new Map<string, FilaSembrada>();
    for (const f of filas) {
      const llave = `${f.provider}::${f.model}::${f.effectiveFrom}`;
      const previa = vistas.get(llave);
      expect(previa, `${llave} sembrado dos veces (${previa?.archivo} y ${f.archivo})`).toBeUndefined();
      vistas.set(llave, f);
    }
  });

  it('las columnas de caché respetan los multiplicadores 1.25× / 2× / 0.1×', () => {
    // No es cosmético: meter las dos escrituras de caché en un solo cubo, o
    // teclear mal un multiplicador, cobra de menos justo en los prompts largos,
    // que son los caros.
    //
    // Sólo Anthropic. Las filas de OpenRouter son RESPALDO —ese proveedor sí
    // reporta el costo real de la llamada y entonces ni se consultan— y vienen
    // redondeadas a la baja desde su tarifario, así que exigirles la regla de
    // multiplicadores sería medir la cosa equivocada.
    for (const f of filas.filter((x) => x.provider === 'anthropic')) {
      expect(f.cacheWrite5mPerMtok, `${f.model} (${f.archivo}) escritura 5m`).toBeCloseTo(
        f.inputPerMtok * 1.25,
        2,
      );
      expect(f.cacheWrite1hPerMtok, `${f.model} (${f.archivo}) escritura 1h`).toBeCloseTo(
        f.inputPerMtok * 2,
        2,
      );
      expect(f.cacheReadPerMtok, `${f.model} (${f.archivo}) lectura`).toBeCloseTo(
        f.inputPerMtok * 0.1,
        2,
      );
    }
  });
});
