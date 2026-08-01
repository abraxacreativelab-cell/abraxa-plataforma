/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El encargo #1: «que nada reviente delante de un invitado»
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Lo peor que puede pasar hoy es la pantalla blanca de React o un stack trace
 *  a la vista en un evento con gente real. Esto lo verifica de tres formas:
 *
 *   1. la frontera CAPTURA (getDerivedStateFromError deja el error en el estado)
 *   2. la frontera SE REARMA al navegar (si no, el error de una pantalla se
 *      queda pegado encima de las siguientes)
 *   3. la pantalla de fallo NO enseña el mensaje técnico en producción, y sí
 *      enseña una salida
 *
 *  Se prueba con `React.createElement` en vez de JSX porque `vitest.config.ts`
 *  —que es de H1 y nadie edita— sólo recoge `*.test.ts`. El renderizado va con
 *  `react-dom/server`, que no necesita DOM: el proyecto no tiene jsdom instalado
 *  y la regla 4 prohíbe instalar dependencias.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FronteraDeError, PantallaDeFallo } from './frontera-de-error';

const html = (nodo: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(nodo);

// ════════════════════════════════════════════════════════════════════════════

describe('la frontera captura', () => {
  it('getDerivedStateFromError deja el error en el estado', () => {
    const e = new Error('undefined no es una función');
    expect(FronteraDeError.getDerivedStateFromError(e)).toEqual({ error: e });
  });

  it('mientras no hay error, pinta a sus hijos tal cual', () => {
    // Los hijos van DENTRO de las props y no como tercer argumento: con
    // `children` obligatorio en las props, la sobrecarga de `createElement` que
    // los toma aparte no encaja y el typecheck se queja. Y obligatorio tiene que
    // ser: una frontera de error sin hijos no protege nada.
    const salida = html(
      createElement(FronteraDeError, {
        resetKey: '/bandeja',
        children: createElement('p', null, 'contenido de otro carril'),
      }),
    );
    expect(salida).toContain('contenido de otro carril');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('la frontera se rearma al navegar', () => {
  const derivar = FronteraDeError.getDerivedStateFromProps;
  const err = new Error('reventó');

  it('cambiar de ruta limpia el error', () => {
    // Sin esto, el usuario pica otra sección y sigue viendo el error de la
    // anterior. Es el defecto clásico de los ErrorBoundary escritos a mano.
    expect(derivar({ resetKey: '/tareas', children: null }, { error: err, clave: '/bandeja' })).toEqual(
      { error: null, clave: '/tareas' },
    );
  });

  it('quedarse en la misma ruta NO lo limpia — si no, sería un bucle de render', () => {
    expect(
      derivar({ resetKey: '/bandeja', children: null }, { error: err, clave: '/bandeja' }),
    ).toBeNull();
  });

  it('navegar sin error sólo actualiza la clave', () => {
    expect(derivar({ resetKey: '/b', children: null }, { error: null, clave: '/a' })).toEqual({
      error: null,
      clave: '/b',
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('la pantalla de fallo es digna, en español y con salida', () => {
  it('no enseña el mensaje técnico en producción', () => {
    const salida = html(
      createElement(PantallaDeFallo, {
        error: new Error("Cannot read properties of undefined (reading 'map')"),
        mostrarDetalle: false,
      }),
    );
    expect(salida).not.toContain('Cannot read properties');
    expect(salida).not.toContain('undefined');
  });

  it('fuera de producción sí lo enseña — depurar a ciegas cuesta más', () => {
    const salida = html(
      createElement(PantallaDeFallo, {
        error: new Error('fetch failed'),
        mostrarDetalle: true,
      }),
    );
    expect(salida).toContain('fetch failed');
  });

  it('habla en español y no culpa al usuario', () => {
    const salida = html(createElement(PantallaDeFallo, {}));
    expect(salida).toContain('No pudimos abrir');
    expect(salida).toContain('No fue algo que hiciste tú');
    for (const ingles of ['Application error', 'Something went wrong', 'Unhandled', 'Error:']) {
      expect(salida).not.toContain(ingles);
    }
  });

  it('nombra la sección cuando se sabe cuál era', () => {
    const salida = html(createElement(PantallaDeFallo, { contexto: 'Ventas' }));
    expect(salida).toContain('No pudimos abrir Ventas');
  });

  it('siempre deja una salida al panel — un error sin salida es un callejón', () => {
    const salida = html(createElement(PantallaDeFallo, {}));
    expect(salida).toContain('href="/panel"');
  });

  it('ofrece reintentar cuando hay algo que reintentar', () => {
    const salida = html(createElement(PantallaDeFallo, { onReintentar: vi.fn() }));
    expect(salida).toContain('Intentar de nuevo');
  });

  it('los dos caminos de salida cumplen el mínimo táctil de 44px', () => {
    // En un teléfono, un botón de 32px de alto se falla al picarlo — y aquí es
    // justo cuando la persona ya está frustrada.
    const salida = html(createElement(PantallaDeFallo, { onReintentar: vi.fn() }));
    expect(salida.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
