import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { marcadoresDeJerga, tieneJerga } from './castellano';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La regla sobre el CÓDIGO FUENTE: ni una frase de pantalla en jerga
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `sinJerga()` es la red que atrapa lo que escriben los OTROS carriles, porque
 *  sus archivos no se pueden editar desde aquí. Pero dentro de `packages/ui` no
 *  hace falta una red: hace falta que no haya nada que atrapar.
 *
 *  Así que esto lee el código fuente —igual que `accent.test.ts` hace con los
 *  hex— saca cada texto que un ojo humano va a leer en pantalla, y falla
 *  nombrando el archivo si alguno trae jerga.
 *
 *  ── Qué cuenta como "texto de pantalla" ────────────────────────────────────
 *
 *  Sólo lo que se PINTA:
 *
 *    · el texto suelto entre etiquetas JSX (`<p>Aún no tienes contactos</p>`)
 *    · los atributos que se leen: `title=`, `aria-label=`, `placeholder=`,
 *      `alt=`, y las props de copy del sistema (`label`, `titulo`, `promesa`,
 *      `texto`, `description`, `blurb`).
 *
 *  Lo que NO cuenta, y por eso hay una lista de exclusión y no un barrido a
 *  ciegas:
 *
 *    · los COMENTARIOS. Están escritos para quien mantiene el código y ahí la
 *      jerga es lo correcto: «(app)/mapa/context.ts:28 devuelve null» es
 *      exactamente lo que necesita leer quien lo va a arreglar. Borrarla de los
 *      comentarios por consistencia sería tirar el diagnóstico.
 *    · los `console.warn` y demás avisos de desarrollo, por lo mismo.
 *    · `POR_QUE_NO_ABRE`, que es la lista de trabajo pendiente con archivo y
 *      línea. No se pinta en ninguna parte —esta misma prueba lo verifica— y su
 *      valor está justo en ser específica.
 *    · las clases de CSS y los nombres de icono, que no son prosa.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const SRC = join(AQUI, '..');

function archivosDeComponente(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) salida.push(...archivosDeComponente(ruta));
    // Sólo `.tsx`: los `.ts` de este paquete son lógica y datos, y los que
    // producen copy (`areas-de-arranque.ts`, `failure.ts`) se revisan aparte
    // más abajo por su export, que es más preciso que un regex.
    else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) salida.push(ruta);
  }
  return salida;
}

/**
 * Quita comentarios antes de buscar. Sin esto, cada bloque de documentación
 * —que sí habla de H11, de ports y de rutas de archivo, y debe— haría fallar la
 * prueba y la única salida sería empeorar los comentarios.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/**
 * El texto suelto entre etiquetas JSX: `>Aún no tienes contactos<`.
 *
 * ── Por qué hay que descartar código, y con cuidado ────────────────────────
 *
 * `>` y `<` no sólo abren y cierran etiquetas: también son comparadores. Un
 * barrido ingenuo saca cosas como `a.slug === activa) ?? null; const barra = (`
 * —el trozo de código entre el `>` de una flecha y el `<` de otra cosa— y
 * después falla por la palabra `null`, que ahí es JavaScript y no una frase.
 *
 * El descarte NO puede hacerse por caracteres "raros": `packages/tenancy` lleva
 * una barra y es justo lo que hay que atrapar. Así que se descarta por lo que
 * distingue de verdad al código de la prosa: un signo `=` o `;`, o empezar por
 * algo que ninguna frase empieza (`)`, `:`, `?`, una coma).
 */
const PALABRAS_DE_CODIGO =
  /\b(function|const|let|var|return|class|interface|type|import|export|static|async|await|extends|implements|readonly|declare)\b/;

function esCodigo(t: string): boolean {
  return (
    // Un signo que la prosa no usa. `|` entra por los tipos unión de
    // TypeScript, que es lo que empezó a colarse al mirar también después de
    // `}`: la llave de cierre de una función pega con el `<` de un genérico.
    /[=;|]/.test(t) ||
    // Una palabra clave del lenguaje. Ninguna frase de producto empieza por
    // `function` ni lleva un `static` en medio.
    PALABRAS_DE_CODIGO.test(t) ||
    // Una firma: paréntesis y dos puntos juntos.
    (t.includes('(') && t.includes(':')) ||
    // Empieza por algo por lo que ninguna frase empieza.
    !/^[\p{L}\d¿¡«"'(]/u.test(t)
  );
}

function textosDeJsx(codigo: string): string[] {
  const salida: string[] = [];
  // Arranca en `>` o en `}`. Lo segundo NO es un detalle: media pantalla del
  // producto es texto que sigue a una interpolación —`Se abre cuando {falta}.`,
  // `Llevas {n} de 7 fases`— y un barrido que sólo mirara después de `>` no
  // vería ni una de esas frases. Se descubrió porque el componente sucio de
  // más abajo trae una a propósito y el barrido la dejaba pasar.
  for (const m of codigo.matchAll(/[>}]([^<>{}]+)</g)) {
    const t = (m[1] ?? '').replace(/\s+/g, ' ').trim();
    // Al menos dos palabras y una letra: descarta signos sueltos y `·`.
    if (t.length > 3 && /\p{L}/u.test(t) && t.includes(' ') && !esCodigo(t)) salida.push(t);
  }
  return salida;
}

/** Los atributos y props que se leen en pantalla. */
const PROPS_DE_COPY =
  /\b(title|aria-label|placeholder|alt|label|titulo|promesa|texto|description|blurb|etiqueta)\s*=\s*(?:"([^"]{4,})"|'([^']{4,})')/g;

function textosDeProps(codigo: string): string[] {
  const salida: string[] = [];
  for (const m of codigo.matchAll(PROPS_DE_COPY)) {
    const t = (m[2] ?? m[3] ?? '').trim();
    if (t.length > 3 && /\p{L}/u.test(t)) salida.push(t);
  }
  return salida;
}

const COMPONENTES = archivosDeComponente(join(SRC, 'components'));

/**
 * ── El barrido tiene que poder FALLAR ──────────────────────────────────────
 *
 * Una prueba de código fuente que se pasa de lista con los descartes deja de
 * mirar nada y sigue en verde para siempre — la peor clase de prueba, porque da
 * confianza sin darla. Así que antes de barrer los archivos de verdad se le
 * pasa un componente inventado con las cinco frases del ensayo dentro, y se
 * exige que las saque todas.
 */
const COMPONENTE_SUCIO = `
'use client';
// Un comentario que SÍ puede hablar de H2 y de packages/tenancy: es para quien
// mantiene el código, y aquí la jerga es lo correcto.
/** También en bloque: (app)/mapa/context.ts:28 devuelve null bajo un TODO(H2). */
export function Sucio({ areas }: { areas: number }) {
  const activa = areas > 3 ? 'sí' : null;
  return (
    <div title="Falta: H2 · packages/tenancy">
      <p>El módulo de sesión y empresa (H2) todavía no está registrado.</p>
      <span>sus migraciones 130–132 están escritas</span>
      <Aviso description="packages/crm está construido y registrado como port." />
      <em>{activa}Falta cablear la ruta (H18).</em>
    </div>
  );
}
`;

describe('el barrido barre de verdad', () => {
  it('saca las cinco frases del ensayo de un componente inventado', () => {
    const codigo = sinComentarios(COMPONENTE_SUCIO);
    const frases = [...textosDeJsx(codigo), ...textosDeProps(codigo)];
    const sucias = frases.filter(tieneJerga);

    expect(sucias.join(' | ')).toContain('H2 · packages/tenancy');
    expect(sucias.join(' | ')).toContain('El módulo de sesión y empresa');
    expect(sucias.join(' | ')).toContain('migraciones 130');
    expect(sucias.join(' | ')).toContain('packages/crm');
    expect(sucias.join(' | ')).toContain('(H18)');
    expect(sucias.length).toBeGreaterThanOrEqual(5);
  });

  it('y NO se queja de los comentarios, que deben seguir siendo específicos', () => {
    const codigo = sinComentarios(COMPONENTE_SUCIO);
    expect(codigo).not.toContain('TODO(H2)');
    expect(codigo).not.toContain('mantiene el código');
  });

  it('descarta el código que se cuela entre un `>` y un `<`', () => {
    const codigo = sinComentarios(COMPONENTE_SUCIO);
    // `areas > 3 ? 'sí' : null;\n  return (\n    <` es lo que sacaría un barrido
    // ingenuo, y `null` lo haría fallar por una razón que no existe.
    expect(textosDeJsx(codigo).some((t) => t.includes('return'))).toBe(false);
  });
});

describe('el código fuente de packages/ui', () => {
  it('tiene componentes que revisar (si esto falla, el barrido dejó de barrer)', () => {
    expect(COMPONENTES.length).toBeGreaterThan(15);
  });

  it.each(COMPONENTES.map((f) => [relative(SRC, f), f] as const))(
    'no pinta jerga interna: %s',
    (_nombre, ruta) => {
      const codigo = sinComentarios(readFileSync(ruta, 'utf8'));
      const frases = [...textosDeJsx(codigo), ...textosDeProps(codigo)];

      const sucias = frases.filter(tieneJerga);
      expect(
        sucias,
        sucias.map((f) => `«${f}» → ${marcadoresDeJerga(f).join(', ')}`).join('\n'),
      ).toEqual([]);
    },
  );
});

/**
 * ── Los tres exports que SÍ son copy de pantalla ───────────────────────────
 *
 * Se revisan por su valor y no por un regex sobre el archivo: es más preciso y
 * no se puede burlar partiendo una cadena en dos líneas.
 */
describe('el copy que este paquete publica', () => {
  it('las áreas de arranque están escritas para el cliente', async () => {
    const { AREAS_DE_ARRANQUE, requisitosDeArranque } = await import(
      '../components/nav/areas-de-arranque'
    );

    for (const a of AREAS_DE_ARRANQUE) {
      expect(tieneJerga(a.label), `label de ${a.slug}`).toBe(false);
      expect(tieneJerga(a.blurb), `blurb de ${a.slug}`).toBe(false);
      expect(tieneJerga(a.fraseDeLaFase), `fraseDeLaFase de ${a.slug}`).toBe(false);
    }

    // Y las frases de "se abre cuando", en los tres estados que puede tener el
    // Ritual: sin empezar, a medias y terminado.
    for (const senales of [
      null,
      { faseIndice: 2, fasesTotales: 7, completado: false, agente: 'Lupita' },
      { faseIndice: 7, fasesTotales: 7, completado: true, agente: 'Chica Guapa' },
    ]) {
      for (const [slug, frase] of Object.entries(requisitosDeArranque(senales))) {
        expect(tieneJerga(frase), `requisito de ${slug}: «${frase}»`).toBe(false);
      }
    }
  });

  it('los cuatro mensajes de fallo hablan de lo que le pasa a él, no de HTTP', async () => {
    const { FAILURE_COPY } = await import('../components/feedback/failure');

    for (const [kind, copy] of Object.entries(FAILURE_COPY)) {
      expect(tieneJerga(copy.titulo), `título de ${kind}`).toBe(false);
      expect(tieneJerga(copy.texto), `texto de ${kind}`).toBe(false);
    }
  });

  it('los estados de área se anuncian en castellano', async () => {
    const { AREAS_DE_ARRANQUE, motivoDeCierre } = await import(
      '../components/nav/areas-de-arranque'
    );
    // `motivoDeCierre` devuelve una etiqueta interna (`'ritual'`/`'construccion'`)
    // que NUNCA se pinta: lo que se pinta es la frase de `requisitosDeArranque`,
    // ya verificada arriba. Esto sólo fija que siga siendo así.
    for (const a of AREAS_DE_ARRANQUE) {
      const m = motivoDeCierre(a, null);
      expect(m === null || m === 'ritual' || m === 'construccion').toBe(true);
    }
  });
});

/**
 * ── `POR_QUE_NO_ABRE` es documentación, y tiene que seguir siéndolo ─────────
 *
 * Es la lista de trabajo pendiente con archivo y línea. Su valor está en ser
 * específica, así que NO se le quita la jerga — se le prohíbe llegar a una
 * pantalla. Si alguien la importa desde un `.tsx`, esto falla.
 */
describe('POR_QUE_NO_ABRE nunca llega a una pantalla', () => {
  it('ningún componente la importa', () => {
    const culpables = COMPONENTES.filter((f) =>
      readFileSync(f, 'utf8').includes('POR_QUE_NO_ABRE'),
    ).map((f) => relative(SRC, f));

    expect(
      culpables,
      `Estos componentes la referencian y es documentación interna: ${culpables.join(', ')}`,
    ).toEqual([]);
  });

  it('y sigue siendo específica — si dejara de serlo, no serviría para nada', async () => {
    const { POR_QUE_NO_ABRE } = await import('../components/nav/areas-de-arranque');
    for (const [slug, nota] of Object.entries(POR_QUE_NO_ABRE)) {
      expect(nota.length, `la nota de ${slug} se quedó corta`).toBeGreaterThan(40);
    }
  });
});
