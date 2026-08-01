/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los contratos que este carril tiene con OTROS árboles, comprobados.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Este carril protege código que no le pertenece y depende de reglas que no
 *  escribió. Las dos cosas son frágiles de la misma manera: nadie que edite el
 *  otro archivo sabe que esto existe.
 *
 *  Así que se comprueban contra el CÓDIGO FUENTE. Si H15 cambia de cabecera o
 *  H2 cambia el formato del slug, se pone rojo aquí — con el archivo y la línea
 *  delante— en vez de descubrirse en vivo.
 *
 *  Leer fuente en una prueba es feo y es lo correcto: la alternativa es
 *  importar módulos de `apps/web` que arrastran `next/headers`, `@abraxa/ui` y
 *  React al proyecto de TypeScript de Node, o importar `@abraxa/tenancy`, que
 *  arrastra `pg` y el registro de ports al bundle del BFF.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CABECERA_CORREO, CABECERA_EMPRESA } from '../../../apps/web/app/api/_auth/cabeceras';
import { FORMATO_SLUG, slugDeCorreo } from './slug';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leer = (ruta: string): string => readFileSync(join(RAIZ, ruta), 'utf8');

describe('las dos pantallas que este middleware protege', () => {
  /**
   * H16 · `/ajustes/plan`. Su `cabeceras()` lee estas dos de `headers()`, que
   * devuelve las de la petición ENTRANTE. Es el agujero, y este carril lo
   * cierra desde fuera sin tocar su archivo.
   */
  it('la de PLAN (H16) sigue resolviendo la identidad por estas dos cabeceras', () => {
    const fuente = leer('apps/web/app/(app)/ajustes/plan/_lib/datos.ts');
    expect(fuente).toContain(`h.get('${CABECERA_CORREO}')`);
    expect(fuente).toContain(`h.get('${CABECERA_EMPRESA}')`);
    expect(fuente).toContain("import { headers } from 'next/headers'");
  });

  /** H15 · `/contactos`. Lo mismo, línea 42-43 de su `datos.ts`. */
  it('la de CONTACTOS (H15) también', () => {
    const fuente = leer('apps/web/app/(app)/contactos/datos.ts');
    expect(fuente).toContain(`h.get('${CABECERA_CORREO}')`);
    expect(fuente).toContain(`h.get('${CABECERA_EMPRESA}')`);
    expect(fuente).toContain("import { headers } from 'next/headers'");
  });
});

describe('el formato del slug, que lo manda H2 y la migración 010', () => {
  it('`FORMATO_SLUG` es idéntico al `SLUG_RE` de packages/tenancy', () => {
    const fuente = leer('packages/tenancy/src/schemas.ts');
    const m = /export const SLUG_RE = (\/.+\/);/.exec(fuente);

    expect(m, 'no se encontró SLUG_RE en packages/tenancy/src/schemas.ts').not.toBeNull();
    expect(m?.[1]).toBe(FORMATO_SLUG.toString());
  });

  it('ningún slug generado cae en la lista de reservados', () => {
    const fuente = leer('packages/tenancy/src/schemas.ts');
    const bloque = /RESERVED_SLUGS[^=]*=\s*\[([\s\S]*?)\]/.exec(fuente)?.[1] ?? '';
    const reservados = [...bloque.matchAll(/'([a-z]+)'/g)].map((x) => x[1] as string);

    expect(reservados.length).toBeGreaterThan(20);

    // Un correo por cada palabra reservada: `admin@x.com`, `api@x.com`…
    // La huella los saca a todos de la lista, que es justo lo que se quiere.
    for (const palabra of reservados) {
      const slug = slugDeCorreo(`${palabra}@ejemplo.com`);
      expect(reservados, `el slug de ${palabra}@ejemplo.com`).not.toContain(slug);
      expect(FORMATO_SLUG.test(slug), `formato de ${slug}`).toBe(true);
    }
  });
});

describe('la ruta de NextAuth, que la fija nginx', () => {
  /**
   * nginx tiene `location ^~ /api/auth/ → 3041 (Next)` ANTES del `location
   * /api/ → 3040 (Express)`. Si el handler se moviera de sitio, el callback de
   * Google caería en Express y contestaría 404 — después de que el invitado ya
   * aceptó el permiso, que es el peor momento para fallar.
   */
  it('el handler vive en app/api/auth/[...nextauth]/route.ts', () => {
    const fuente = leer('apps/web/app/api/auth/[...nextauth]/route.ts');
    expect(fuente).toContain("import NextAuth from 'next-auth'");
    expect(fuente).toContain('export { handler as GET, handler as POST }');
  });

  it('`authOptions` se exporta con ese nombre desde app/api/auth/opciones.ts', () => {
    const fuente = leer('apps/web/app/api/auth/opciones.ts');
    expect(fuente).toContain('export const authOptions');
  });
});
