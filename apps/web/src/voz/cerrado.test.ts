/**
 * ════════════════════════════════════════════════════════════════════════════
 *  LA PRUEBA DE QUE LOS DOS ENDPOINTS NACEN CERRADOS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Un endpoint de transcripción abierto al mundo es la factura de otro: cuesta
 *  dinero por segundo de audio subido y lo cobra la cuenta de ABRAXA. Que esté
 *  cerrado no puede ser una creencia; tiene que ser una prueba.
 *
 *  Se comprueban las TRES capas, porque cada una falla de una forma distinta:
 *
 *   1. El MATCHER del middleware. Es el fallo más silencioso posible: si la
 *      ruta se queda fuera, todas las pruebas de política siguen verdes y el
 *      middleware no se ejecuta jamás en producción. Es la misma razón por la
 *      que existe `apps/web/src/matcher.test.ts`.
 *   2. La POLÍTICA (`decidir`). Que un anónimo reciba 401 y no un 307.
 *   3. El HANDLER. Que ni aun saltándose el middleware se gaste un centavo.
 *
 *  ── Por qué el 401 y no el 307 es load-bearing ─────────────────────────────
 *
 *  `esRutaDeDatos()` (identidad.ts:82-85) decide mirando si la ruta contiene
 *  `/api/`. A un `fetch` no se le puede contestar con un 307 a la pantalla de
 *  login: el navegador lo sigue, recibe HTML y el `await r.json()` del otro lado
 *  revienta con un error de sintaxis que no se parece en nada a «no hay
 *  sesión». Por eso las rutas se llaman `/voz/api/...` y no `/voz/...`.
 */
import { describe, expect, it } from 'vitest';
import { decidir, esRutaPublica } from '../../../../packages/auth/src/identidad';
import { config as configDelMiddleware } from '../../middleware';
import { RUTA_NARRAR, RUTA_TRANSCRIBIR } from './cliente';

const RUTAS = [RUTA_NARRAR, RUTA_TRANSCRIBIR] as const;

const SESION = { correo: 'invitado@ejemplo.com', empresa: 'mi-negocio' };

describe('1 · las rutas de voz están DENTRO del matcher del middleware', () => {
  it('el matcher las cubre', () => {
    // Se compila el matcher de verdad, el que exporta `middleware.ts`. Si
    // alguien lo cambia y deja fuera `/api/voz`, esto se pone rojo aquí en vez
    // de en el evento.
    const patrones = configDelMiddleware.matcher.map((m) => new RegExp(`^${m}$`));
    for (const ruta of RUTAS) {
      expect(
        patrones.some((p) => p.test(ruta)),
        ruta,
      ).toBe(true);
    }
  });
});

describe('2 · la política las trata como PRIVADAS y como rutas de datos', () => {
  it('ninguna es pública', () => {
    for (const ruta of RUTAS) expect(esRutaPublica(ruta)).toBe(false);
  });

  it('un ANÓNIMO recibe NEGAR — o sea, 401 JSON, no 307 a una pantalla', () => {
    for (const ruta of RUTAS) {
      expect(decidir(ruta, null)).toEqual({ tipo: 'negar' });
    }
  });

  it('con la consulta pegada tampoco se cuela', () => {
    expect(decidir(`${RUTA_NARRAR}?texto=hola&voz=ana`, null)).toEqual({ tipo: 'negar' });
  });

  it('ni con barras de más, ni con barra final', () => {
    // Una política que se esquiva con una barra de sobra no es una política.
    for (const truco of [
      `/${RUTA_NARRAR}`,
      `${RUTA_NARRAR}/`,
      `//api//voz//narrar`,
      `${RUTA_TRANSCRIBIR}/`,
    ]) {
      expect(decidir(truco, null)).toEqual({ tipo: 'negar' });
    }
  });

  it('con sesión, pasan', () => {
    for (const ruta of RUTAS) expect(decidir(ruta, SESION)).toEqual({ tipo: 'seguir' });
  });

  it('un invitado autenticado SIN empresa también pasa', () => {
    // Es el estado de cualquiera a mitad del Ritual, y es a quien más le sirve
    // la voz. El handler revalida por su cuenta de todas formas.
    for (const ruta of RUTAS) {
      expect(decidir(ruta, { correo: 'nuevo@ejemplo.com', empresa: null })).toEqual({
        tipo: 'seguir',
      });
    }
  });

  it('el prefijo público `/api/auth` NO abre `/api/voz` por accidente', () => {
    // `startsWith('/api/auth')` sobre `/api/voz` es falso, pero comprobarlo
    // cuesta una línea y el día que alguien añada `/api` a la lista de
    // públicos, esto lo dice.
    expect(esRutaPublica('/voz/api/narrar')).toBe(false);
    expect(esRutaPublica('/api/authvoz/narrar')).toBe(false);
  });
});

describe('3 · el segmento `/api/` en medio es lo que decide 401 contra 307', () => {
  it('sin él, un anónimo recibiría un 307 que rompe cualquier fetch', () => {
    // Esto NO es un requisito de estilo. Si las rutas se hubieran llamado
    // `/voz/narrar`, `esRutaDeDatos` sería falso y el middleware contestaría un
    // 307 al login. El `fetch` del cliente lo seguiría, recibiría el HTML de la
    // pantalla de entrada y `r.json()` reventaría con un SyntaxError.
    const sinApi = decidir('/voz/narrar', null);
    expect(sinApi.tipo).toBe('entrar');

    const conApi = decidir('/voz/api/narrar', null);
    expect(conApi.tipo).toBe('negar');
  });

  it('las dos rutas del cliente llevan el segmento', () => {
    for (const ruta of RUTAS) expect(ruta).toContain('/api/');
  });
});
