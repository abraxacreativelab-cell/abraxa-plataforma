/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El guardián: que no vuelva a salir jerga en la cara del cliente.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El 2026-07-31 un invitado recorrió el producto entero y su veredicto fue
 *  «no lo enseñes». Cinco pantallas le hablaban en jerga interna: «Falta: H2 ·
 *  packages/tenancy», «packages/crm está construido… por el contrato de no
 *  colisión», «migraciones 130-132».
 *
 *  Arreglarlas una vez no sirve de nada si la sexta nace igual. Esto lee los
 *  archivos del carril y falla si encuentra un patrón de `PATRONES_DE_JERGA`
 *  en algo que un cliente pueda leer.
 *
 *  ── Qué cuenta como "algo que un cliente pueda leer" ──────────────────────
 *
 *  Dos cosas, y sólo dos, porque son las dos por las que salió la jerga:
 *
 *   1. **Las pantallas** — `apps/web/app/(app)/direccion/**`: el texto suelto
 *      del JSX y los atributos que se pintan (`titulo`, `placeholder`,
 *      `aria-label`…).
 *
 *   2. **Los errores que la bóveda escribe para una persona** — los
 *      `PlatformError` cuyo código pasa `mensajeEsParaElCliente()`. Un
 *      `INTERNAL` arrastra texto de Postgres y por eso NO se pinta nunca; ése
 *      queda fuera a propósito, y quien lo garantiza es `actions.ts`.
 *
 *  Lo que NO se mira, por qué sería ruido: comentarios (ahí la jerga es
 *  correcta y necesaria), listas de columnas de SQL, líneas de `console.*`,
 *  nombres de pruebas, y lo que va dentro de `${…}` — una interpolación es
 *  código, no texto.
 *
 *  Escotilla: `// jerga-ok: <por qué>` en la misma línea. Exige escribir el
 *  motivo al lado, que es todo el punto.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  etiquetaCampo,
  etiquetaDeClave,
  etiquetaDocType,
  etiquetaKind,
  jergaEn,
  mensajeEsParaElCliente,
  PATRONES_DE_JERGA,
} from './copy';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..'); // packages/vault/src → raíz del repo

const PANTALLAS = join(RAIZ, 'apps', 'web', 'app', '(app)', 'direccion');
const PAQUETE = join(RAIZ, 'packages', 'vault', 'src');

/** `copy.ts` y este archivo CONTIENEN la lista de jerga prohibida. */
const EXENTOS = new Set(['copy.ts', 'sin-jerga.test.ts']);

function archivos(dir: string, filtro: (n: string) => boolean): string[] {
  let salida: string[] = [];
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return [];
  }
  for (const entrada of entradas) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada === 'node_modules' || entrada === '.next' || entrada === 'testing') continue;
      salida = salida.concat(archivos(ruta, filtro));
    } else if (filtro(entrada) && !EXENTOS.has(entrada)) {
      salida.push(ruta);
    }
  }
  return salida;
}

const esFuente = (n: string): boolean => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n);

/**
 * Deja el archivo con sólo lo que puede ser texto para una persona.
 *
 * Se van, EN ESTE ORDEN: las líneas con la escotilla —primero, porque la
 * escotilla vive dentro de un comentario y el paso siguiente se los lleva—,
 * los comentarios de bloque, los de línea, las llamadas a `console.*` y el
 * contenido de las interpolaciones `${…}`, que es código y no texto.
 */
function soloTexto(fuente: string): string {
  return fuente
    .replace(/^.*\/\/\s*jerga-ok:.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/console\.\w+\([\s\S]*?\);/g, ' ')
    .replace(/\$\{[^}]*\}/g, '');
}

/** `true` si la cadena es una lista de columnas, un identificador o una ruta. */
function esIdentificador(texto: string): boolean {
  const t = texto.trim().replace(/[,\s]+$/, '');
  if (!t) return true;
  if (/^[./#@]/.test(t)) return true; // rutas, clases, selectores
  if (/^[a-z][a-z0-9_]*$/.test(t)) return true; // una columna suelta
  if (/^[a-z0-9_]+(\s*,\s*[a-z0-9_]+)+$/.test(t)) return true; // lista de columnas
  if (!/[a-záéíóúüñ]{3}/i.test(t)) return true; // sin una sola palabra
  return false;
}

interface Hallazgo {
  archivo: string;
  linea: number;
  texto: string;
  patrones: string[];
}

function revisar(texto: string, archivo: string, linea: number, dentro: Hallazgo[]): void {
  if (esIdentificador(texto)) return;
  const patrones = jergaEn(texto);
  if (patrones.length > 0) {
    dentro.push({ archivo: relative(RAIZ, archivo), linea, texto: texto.trim(), patrones });
  }
}

/** Atributos de JSX cuyo valor se pinta o lo lee un lector de pantalla. */
const ATRIBUTOS_VISIBLES =
  /\b(?:titulo|descripcion|detalle|texto|etiqueta|ayuda|nota|blurb|label|placeholder|aria-label|title|alt)=(?:"([^"]*)"|'([^']*)'|\{'([^']*)'\}|\{`([^`]*)`\})/g;

/** Texto suelto de JSX: `>  Lo que sea  <`. */
const TEXTO_JSX = />\s*([^<>{}\n][^<>{}]*?)\s*</g;

// ════════════════════════════════════════════════════════════════════════════

describe('las pantallas de Dirección no le hablan al cliente en jerga interna', () => {
  const hallazgos: Hallazgo[] = [];
  const revisados = archivos(PANTALLAS, esFuente);

  for (const archivo of revisados) {
    const limpio = soloTexto(readFileSync(archivo, 'utf8'));
    limpio.split('\n').forEach((linea, i) => {
      for (const m of linea.matchAll(ATRIBUTOS_VISIBLES)) {
        revisar(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '', archivo, i + 1, hallazgos);
      }
      for (const m of linea.matchAll(TEXTO_JSX)) {
        revisar(m[1] ?? '', archivo, i + 1, hallazgos);
      }
    });
  }

  it('no encuentra jerga en nada de lo que se pinta', () => {
    const informe = hallazgos
      .map((h) => `  ${h.archivo}:${h.linea}\n    «${h.texto}»\n    → ${h.patrones.join(', ')}`)
      .join('\n');
    expect(hallazgos, `Jerga interna en texto que ve el cliente:\n${informe}`).toEqual([]);
  });

  it('de verdad está leyendo las pantallas (si no, lo de arriba es un placebo)', () => {
    expect(revisados.length).toBeGreaterThanOrEqual(10);
  });
});

describe('los errores que la bóveda escribe PARA una persona tampoco', () => {
  const hallazgos: Hallazgo[] = [];
  const revisados = archivos(PAQUETE, esFuente);

  // `new PlatformError('CODIGO', 'mensaje…')` — sólo los códigos que se pintan.
  const ERROR = /new PlatformError\(\s*'([A-Z_]+)'\s*,\s*([\s\S]{0,400}?)\)\s*[;,)]/g;

  for (const archivo of revisados) {
    const limpio = soloTexto(readFileSync(archivo, 'utf8'));
    for (const m of limpio.matchAll(ERROR)) {
      const codigo = m[1] ?? '';
      if (!mensajeEsParaElCliente(codigo)) continue;
      const cuerpo = m[2] ?? '';
      const linea = limpio.slice(0, m.index ?? 0).split('\n').length;
      for (const lit of cuerpo.matchAll(/'([^'\\]{4,})'|"([^"\\]{4,})"|`([^`\\]{4,})`/g)) {
        revisar(lit[1] ?? lit[2] ?? lit[3] ?? '', archivo, linea, hallazgos);
      }
    }
  }

  it('no encuentra jerga en un mensaje de validación, permiso o conflicto', () => {
    const informe = hallazgos
      .map((h) => `  ${h.archivo}:${h.linea}\n    «${h.texto}»\n    → ${h.patrones.join(', ')}`)
      .join('\n');
    expect(hallazgos, `Jerga interna en un error que sí se pinta:\n${informe}`).toEqual([]);
  });

  it('de verdad está leyendo el paquete', () => {
    expect(revisados.length).toBeGreaterThanOrEqual(20);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Que el detector detecte
// ════════════════════════════════════════════════════════════════════════════

describe('los patrones de jerga atrapan lo que el ensayo encontró', () => {
  const delEnsayo = [
    'Falta: H2 · packages/tenancy',
    'packages/crm está construido pero no montado por el contrato de no colisión',
    'Se aplicaron las migraciones 130-132',
    'Se abre cuando termine el handoff de tu agente',
    'La búsqueda por significado está en pausa (OPENAI_API_KEY ausente)',
    'El port todavía no está implementado: usePort falló',
    'scope_id: Un valor general no lleva scope_id',
    'Falta cablear la sesión verificada con TenancyPort.contextFor().',
  ];

  for (const frase of delEnsayo) {
    it(`atrapa «${frase.slice(0, 44)}…»`, () => {
      expect(jergaEn(frase).length).toBeGreaterThan(0);
    });
  }

  const limpias = [
    'Tu bóveda está lista y vacía',
    'Define tus números una vez. Se actualizan en todos lados para siempre.',
    'Ya existe un valor con esa clave en ese alcance.',
    'Nada se usa hasta que tú lo apruebes.',
    'Esta bóveda no es tuya',
    'Ahora mismo estoy buscando sólo por palabras exactas, no por significado.',
    'Sube el precio de una instalación de $1,500 a $1,800 y cambia en todos lados.',
  ];

  for (const frase of limpias) {
    it(`deja pasar «${frase.slice(0, 44)}…»`, () => {
      expect(jergaEn(frase)).toEqual([]);
    });
  }

  it('la lista de patrones no se quedó vacía por accidente', () => {
    expect(PATRONES_DE_JERGA.length).toBeGreaterThanOrEqual(8);
  });
});

describe('el filtro de identificadores no se traga el copy de verdad', () => {
  it('descarta listas de columnas y nombres sueltos', () => {
    expect(esIdentificador('id, key, label, kind, value_text')).toBe(true);
    expect(esIdentificador('scope_id')).toBe(true);
    expect(esIdentificador('/direccion/valores')).toBe(true);
    expect(esIdentificador('   ')).toBe(true);
  });

  it('no descarta una frase', () => {
    expect(esIdentificador('Falta: H2 · packages/tenancy')).toBe(false);
    expect(esIdentificador('Nada se usa hasta que tú lo apruebes.')).toBe(false);
  });
});

describe('soloTexto quita lo que no es texto', () => {
  it('quita los comentarios, donde la jerga sí es correcta', () => {
    expect(soloTexto('/* H2 · packages/tenancy */ const a = 1;')).not.toContain('packages');
    expect(soloTexto('const a = 1; // H2 · packages/tenancy')).not.toContain('packages');
  });

  it('quita las líneas de console, que son para el operador', () => {
    expect(soloTexto("console.error('tryPort quedó vacío');")).not.toContain('tryPort');
  });

  it('quita el interior de las interpolaciones, que es código', () => {
    expect(soloTexto('`área ${row.scope_id}`')).not.toContain('scope_id');
  });

  it('respeta la escotilla, pero deja el resto del archivo', () => {
    const fuente = "const a = 'scope_id'; // jerga-ok: es el nombre del campo\nconst b = 'hola';";
    const limpio = soloTexto(fuente);
    expect(limpio).not.toContain('scope_id');
    expect(limpio).toContain('hola');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// El vocabulario visible
// ════════════════════════════════════════════════════════════════════════════

describe('el vocabulario visible', () => {
  it('traduce los tipos de documento, incluido el que nadie entiende', () => {
    expect(etiquetaDocType('sop')).toBe('Cómo se hace');
    expect(etiquetaDocType('faq')).toBe('Preguntas frecuentes');
    expect(etiquetaDocType('precios')).toBe('Precios');
  });

  it('no revienta con un tipo que no conoce ni con null', () => {
    expect(etiquetaDocType('inventado')).toBe('Otro');
    expect(etiquetaDocType(null)).toBe('Otro');
    expect(etiquetaDocType(undefined)).toBe('Otro');
  });

  it('nombra los campos en castellano', () => {
    expect(etiquetaCampo('scope_id')).toBe('el área del alcance');
    expect(etiquetaCampo('value_text')).toBe('el texto');
  });

  it('un campo desconocido al menos pierde el guion bajo', () => {
    expect(etiquetaCampo('campo_nuevo')).toBe('campo nuevo');
  });

  it('traduce los tipos de valor', () => {
    expect(etiquetaKind('money')).toBe('Monto');
    expect(etiquetaKind('bool')).toBe('Sí / No');
    expect(etiquetaKind('lo-que-sea')).toBe('Valor');
  });

  it('dice las claves de la bóveda como se dicen', () => {
    // Las dos que hay hoy en el catálogo por defecto.
    expect(etiquetaDeClave('ticket_promedio')).toBe('Ticket promedio');
    expect(etiquetaDeClave('iva_pct')).toBe('IVA (%)');
  });

  it('respeta las siglas y no las deja a medias', () => {
    expect(etiquetaDeClave('comision_pct')).toBe('Comisión (%)'.replace('ó', 'o'));
    expect(etiquetaDeClave('rfc')).toBe('RFC');
    expect(etiquetaDeClave('precio_mxn')).toBe('Precio (MXN)');
  });

  it('no revienta con una clave vacía o rara', () => {
    expect(etiquetaDeClave('')).toBe('');
    expect(etiquetaDeClave('___')).toBe('');
    expect(etiquetaDeClave('pct')).toBe('Pct');
  });

  it('ninguna etiqueta visible trae jerga', () => {
    const todas = [
      ...[
        'sop',
        'contrato',
        'precios',
        'guion',
        'politica',
        'manual',
        'faq',
        'plantilla',
        'otro',
      ].map(etiquetaDocType),
      ...['money', 'percent', 'number', 'text', 'date', 'bool', 'list'].map(etiquetaKind),
      ...['key', 'label', 'value_text', 'scope_id', 'area_slug'].map(etiquetaCampo),
    ];
    for (const etiqueta of todas) expect(jergaEn(etiqueta)).toEqual([]);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `copy.ts` tiene que seguir siendo seguro para el navegador.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Costó un build entero descubrirlo. El lector de documentos es un componente
 *  de CLIENTE; en cuanto importó una función del barril `@abraxa/vault/api`,
 *  webpack se trajo `resolver.ts` → `@abraxa/db` → `http/proxy-verified.ts` →
 *  `node:crypto`, y `next build` murió con:
 *
 *      Module build failed: UnhandledSchemeError:
 *      Reading from "node:crypto" is not handled by plugins
 *
 *  Un error que no se parece en nada a su causa —«toqué un texto y se cayó el
 *  build»— y que además tarda cuatro minutos en aparecer.
 *
 *  Por eso `copy.ts` se publica aparte en `@abraxa/vault/copy` y no importa
 *  NADA en ejecución. Esto lo comprueba en milisegundos, leyendo el archivo.
 */
describe('copy.ts se puede importar desde el navegador', () => {
  const fuente = readFileSync(join(AQUI, 'copy.ts'), 'utf8');

  const imports = [...soloTexto(fuente).matchAll(/^\s*import\s+([\s\S]*?)from\s+'([^']+)'/gm)].map(
    ([, cuerpo = '', modulo = '']) => ({ cuerpo, modulo }),
  );

  it('no importa nada en ejecución: todos sus imports son de tipos', () => {
    const deEjecucion = imports.filter((i) => !/^\s*type\b/.test(i.cuerpo));
    expect(
      deEjecucion.map((i) => i.modulo),
      'copy.ts ganó un import de ejecución. Lo consumen componentes de cliente: ' +
        'un import de valor arrastra @abraxa/db y node:crypto al navegador.',
    ).toEqual([]);
  });

  it('y no importa @abraxa/db ni de tipos, que es de donde viene el problema', () => {
    expect(imports.map((i) => i.modulo).filter((m) => m.startsWith('@abraxa/db'))).toEqual([]);
  });

  it('el subcamino ./copy sigue publicado en package.json', () => {
    const pkg = JSON.parse(readFileSync(join(AQUI, '..', 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    expect(pkg.exports?.['./copy']).toBeTruthy();
  });

  it('ningún componente de cliente del carril importa el barril como VALOR', () => {
    const culpables: string[] = [];
    for (const archivo of archivos(PANTALLAS, esFuente)) {
      const fuenteArchivo = readFileSync(archivo, 'utf8');
      if (!/^\s*['"]use client['"]/m.test(fuenteArchivo)) continue;
      const limpio = soloTexto(fuenteArchivo);
      for (const [, cuerpo = '', modulo = ''] of limpio.matchAll(
        /^\s*import\s+([\s\S]*?)from\s+'([^']+)'/gm,
      )) {
        const esBarril = modulo === '@abraxa/vault' || modulo === '@abraxa/vault/api';
        if (esBarril && !/^\s*type\b/.test(cuerpo)) culpables.push(relative(RAIZ, archivo));
      }
    }
    expect(
      culpables,
      'Un componente de cliente importa el barril de la bóveda como valor. ' +
        'Usa `@abraxa/vault/copy` para texto, o `import type` para tipos.',
    ).toEqual([]);
  });
});

describe('qué mensaje de error se le puede enseñar al cliente', () => {
  it('los escritos a mano, sí', () => {
    expect(mensajeEsParaElCliente('VALIDATION')).toBe(true);
    expect(mensajeEsParaElCliente('CONFLICT')).toBe(true);
    expect(mensajeEsParaElCliente('FORBIDDEN')).toBe(true);
    expect(mensajeEsParaElCliente('NOT_FOUND')).toBe(true);
  });

  it('los que arrastran texto de Postgres o de un proveedor, NO', () => {
    expect(mensajeEsParaElCliente('INTERNAL')).toBe(false);
    expect(mensajeEsParaElCliente('PROVIDER_ERROR')).toBe(false);
    expect(mensajeEsParaElCliente('CHANNEL_ERROR')).toBe(false);
  });

  it('y tampoco el de un port sin registrar, que era el que se filtraba', () => {
    // El texto literal de `usePort()` incluye «packages/tenancy» y «el gate de
    // propiedad falla tu PR». Terminaba en el navegador de un cliente.
    expect(mensajeEsParaElCliente('PORT_NOT_IMPLEMENTED')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// El catálogo, bien escrito
// ════════════════════════════════════════════════════════════════════════════

/**
 * Las 109 cadenas del catálogo por giro salen TAL CUAL en /direccion: son los
 * títulos y las pistas de «qué le falta a tu negocio». El seed de la 033 se
 * escribió entero sin un solo acento —«Cotizacion», «Politica de envios»,
 * «diseno»— y así se veía en producción. La 034 lo arregla; esto vigila que no
 * vuelva, ni en la migración ni en el respaldo en memoria.
 *
 * No comprueba ortografía: comprueba que ciertas palabras concretas, que
 * SIEMPRE llevan tilde o eñe, no aparezcan sin ella.
 */
describe('el catálogo por giro está escrito con acentos', () => {
  const SIN_TILDE =
    /\b(Cotizacion|Politica|Garantia|Direccion|Menu|Envios|nomina|minimo|estandar|cafeteria|boveda|numeros|produccion|operacion|atencion|facturacion|penalizacion|prestacion|contratacion|resenas|diseno|linea)\b/g;

  function textoVisible(fuente: string): string {
    return fuente
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
  }

  it('la migración 034 no deja una sola palabra sin su tilde', () => {
    const ruta = join(RAIZ, 'migrations', '034_catalogo_con_acentos.sql');
    const cuerpo = textoVisible(readFileSync(ruta, 'utf8'));
    expect([...new Set(cuerpo.match(SIN_TILDE) ?? [])]).toEqual([]);
  });

  it('y de verdad reescribe los cinco giros', () => {
    const ruta = join(RAIZ, 'migrations', '034_catalogo_con_acentos.sql');
    const cuerpo = readFileSync(ruta, 'utf8');
    for (const giro of ['servicios', 'comercio', 'restaurante', 'agencia', 'general']) {
      expect(cuerpo, `falta el giro ${giro}`).toContain(`WHERE id = '${giro}'`);
    }
  });

  it('el respaldo en memoria tampoco', () => {
    const fuente = soloTexto(readFileSync(join(AQUI, 'industry', 'catalog.ts'), 'utf8'));
    expect([...new Set(fuente.match(SIN_TILDE) ?? [])]).toEqual([]);
  });
});
