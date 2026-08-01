/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Que la landing tenga por dónde entrar. Y que no prometa lo que no cumple.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El ensayo del 2026-07-31 encontró dos cosas en estas pantallas, y las dos
 *  cuestan usuarios de verdad:
 *
 *   1. La palabra «Entrar» NO APARECÍA en el HTML de la landing. El único
 *      camino hacia adentro era el formulario que va a Stripe, así que quien ya
 *      se dio de alta no tenía por dónde volver. Un producto sin puerta de
 *      regreso pierde justo a los usuarios que ya convirtió.
 *
 *   2. `/gracias` prometía un correo que no sale. `enviarBienvenida()` necesita
 *      `RESEND_API_KEY` y esa variable no existe en producción, así que se
 *      mandaba a alguien que ACABA DE PAGAR a vigilar su bandeja de spam
 *      esperando algo que nunca iba a llegar.
 *
 *  Las dos son regresiones invisibles: nada revienta, no hay error en consola,
 *  el build pasa. Se descubren con una persona delante — o aquí.
 *
 *  ── Por qué se lee el fuente y no se renderiza ─────────────────────────────
 *
 *  Igual que `packages/auth/src/contrato.test.ts`: importar estas páginas
 *  arrastraría `next/font`, `@abraxa/ui` y React al proyecto de TypeScript de
 *  Node, y `packages/**` no alcanza los tipos de `next`. Leer el archivo es feo
 *  y comprueba exactamente lo que el ensayo miró: lo que dice la pantalla.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUTA_DE_ENTRADA } from '../../auth/src/identidad';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leer = (ruta: string): string => readFileSync(join(RAIZ, ruta), 'utf8');

/**
 * El archivo SIN comentarios.
 *
 * Estas pantallas llevan comentarios largos que explican por qué existe la
 * puerta de entrada — y esos comentarios contienen la palabra «Entrar». Sin
 * quitarlos, una prueba de `toContain('Entrar')` seguiría verde después de que
 * alguien borrara el botón y dejara la explicación: exactamente la regresión
 * que esto existe para atrapar.
 */
const leerSinComentarios = (ruta: string): string =>
  leer(ruta)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const LAYOUT = 'apps/web/app/(public)/layout.tsx';
const LANDING = 'apps/web/app/(public)/page.tsx';
const GRACIAS = 'apps/web/app/(public)/gracias/page.tsx';

describe('la puerta de entrada existe', () => {
  it('el encabezado público dice «Entrar»', () => {
    expect(leerSinComentarios(LAYOUT)).toContain('Entrar');
  });

  it('la landing también la ofrece junto al formulario', () => {
    const fuente = leerSinComentarios(LANDING);
    expect(fuente).toContain('¿Ya tienes cuenta?');
    expect(fuente).toContain('Entrar');
  });

  /**
   * El destino es la pieza canónica, no una cadena escrita a mano. Si H18
   * mueve la pantalla de entrada, `RUTA_DE_ENTRADA` cambia y estas pantallas
   * la siguen solas.
   */
  it('las tres apuntan a RUTA_DE_ENTRADA y no a una cadena inventada', () => {
    for (const ruta of [LAYOUT, LANDING, GRACIAS]) {
      const fuente = leerSinComentarios(ruta);
      expect(fuente, ruta).toContain('href={RUTA_DE_ENTRADA}');
      expect(fuente, ruta).toContain('packages/auth/src/identidad');
      // Nadie escribe la ruta a mano: si H18 la mueve, se mueven las tres.
      expect(fuente, ruta).not.toContain('"/api/auth/signin"');
    }
    expect(RUTA_DE_ENTRADA).toBe('/api/auth/signin');
  });

  /**
   * `/entrar` está listada como pública en `identidad.ts` para que el día que
   * exista no haya bucle de redirección — pero HOY NO EXISTE. Enlazarla sería
   * cambiar el problema del ensayo (no hay puerta) por el mismo problema con
   * otra cara (la puerta da a un 404).
   */
  it('ninguna pantalla pública enlaza /entrar, que todavía no existe', () => {
    for (const ruta of [LAYOUT, LANDING, GRACIAS]) {
      expect(leerSinComentarios(ruta), ruta).not.toContain('/entrar');
    }
  });

  /**
   * `/api/auth/signin` es un Route Handler que devuelve HTML, no una página del
   * App Router. Con `<Link>` el router de cliente intentaría una carga RSC de
   * algo que no lo es; hace falta una navegación de documento completa.
   *
   * Se comprueba por lo que NO puede aparecer —`<Link … RUTA_DE_ENTRADA>`— y no
   * por la forma exacta del `<a>`, que depende de cómo parta las líneas
   * Prettier y cambiaría con cualquier reformateo.
   */
  it('se enlaza con <a> — <Link> no sirve para un Route Handler', () => {
    for (const ruta of [LAYOUT, LANDING, GRACIAS]) {
      const fuente = leerSinComentarios(ruta);
      expect(fuente, ruta).not.toMatch(/<Link[^>]*RUTA_DE_ENTRADA/);
      expect(fuente, ruta).toMatch(/<a\s[^>]*href=\{RUTA_DE_ENTRADA\}/);
    }
  });
});

describe('/gracias dice la verdad', () => {
  /**
   * Sin `RESEND_API_KEY` —que no está en el `.env` de producción—
   * `enviarBienvenida()` devuelve `{ enviado: false, via: 'doble' }` y sólo
   * escribe en consola. Cualquier copy que mande a esperar un correo es falso.
   */
  it('no promete ningún correo', () => {
    const visible = leerSinComentarios(GRACIAS);

    expect(visible).not.toContain('te llega un correo');
    expect(visible).not.toContain('¿Y si no llega el correo?');
    expect(visible).not.toContain('Revisa spam');
  });

  it('manda a entrar con Google, que sí funciona siempre', () => {
    const visible = leerSinComentarios(GRACIAS);
    expect(visible).toContain('Tu espacio ya está listo.');
    expect(visible).toContain('Entrar con Google');
  });

  /**
   * La empresa recién pagada quedó a nombre del correo que recogió Stripe.
   * Quien entre con OTRA cuenta de Google no tiene membresía ahí, así que
   * `empresaDe()` no la encuentra y le crea una NUEVA en plan gratis: pagó y
   * aterriza en un espacio vacío. Es el ticket de soporte más caro de esta
   * pantalla y se evita con una línea de copy.
   */
  it('avisa de usar el mismo correo del pago', () => {
    expect(leerSinComentarios(GRACIAS)).toContain('Usa el mismo correo con el que pagaste');
  });
});
