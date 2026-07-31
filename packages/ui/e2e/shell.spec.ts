import { type Page, expect, test } from '@playwright/test';

/**
 * Los criterios observables del handoff H5, verificados en un navegador de
 * verdad. Cada bloque cita el criterio que prueba.
 *
 * El acento y los estados semánticos se comprueban leyendo `getComputedStyle`,
 * no comparando capturas: una captura dice "cambió algo", el estilo calculado
 * dice "cambió exactamente este token y ningún otro".
 */

const RUTAS = {
  ventas: '/bandeja', // herramienta del área de Ventas — verde
  direccion: '/direccion', // área de Dirección — dorado
  mapa: '/mapa',
};

/** El valor calculado de una variable CSS en un elemento. */
async function token(page: Page, selector: string, name: string) {
  return page.locator(selector).first().evaluate(
    (el, n) => getComputedStyle(el).getPropertyValue(n).trim(),
    name,
  );
}

/**
 * La navegación, por el camino que de verdad usa el usuario en cada ancho.
 *
 * Arriba de `lg` (1024px) la barra es permanente. Por debajo —y eso incluye la
 * tableta en vertical— está colapsada en un cajón que hay que abrir. Una prueba
 * que asuma la barra desplegada sólo prueba el escritorio.
 */
async function abrirNav(page: Page) {
  const permanente = page.getByRole('complementary', { name: 'Navegación principal' });
  if (await permanente.isVisible()) {
    return permanente.getByRole('navigation', { name: 'Áreas de tu negocio' });
  }
  await page.getByRole('button', { name: /Abrir las áreas/ }).click();
  const cajon = page.getByRole('dialog');
  await cajon.waitFor({ state: 'visible' });
  return cajon.getByRole('navigation', { name: 'Áreas de tu negocio' });
}

// ════════════════════════════════════════════════════════════════════════════
// Criterio 1 — arranca y el shell renderiza con navegación mock
// ════════════════════════════════════════════════════════════════════════════

test.describe('criterio 1 · el shell renderiza', () => {
  test('la navegación por áreas se pinta desde los datos', async ({ page }) => {
    await page.goto(RUTAS.ventas);

    const nav = await abrirNav(page);
    await expect(nav).toBeVisible();

    // Las cuatro áreas de v1.
    for (const label of ['Ventas y Marketing', 'Dirección', 'Servicio al cliente', 'Onboarding']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('el contenido del handoff dueño se ve dentro del shell', async ({ page }) => {
    await page.goto(RUTAS.ventas);
    await expect(page.getByRole('heading', { name: 'Bandeja' })).toBeVisible();
  });

  test('las herramientas del área activa se despliegan', async ({ page }) => {
    await page.goto(RUTAS.ventas);
    const nav = await abrirNav(page);
    await expect(nav.getByRole('link', { name: 'Contactos' })).toBeVisible();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio 2 — cambiar el acento recolorea el subárbol, sin un solo hex
// ════════════════════════════════════════════════════════════════════════════

test.describe('criterio 2 · acento contextual por área', () => {
  test('dos áreas distintas producen acentos distintos', async ({ page }) => {
    await page.goto(RUTAS.ventas);
    const ventas = await token(page, '#contenido', '--primary');

    await page.goto(RUTAS.direccion);
    const direccion = await token(page, '#contenido', '--primary');

    expect(ventas).not.toBe('');
    expect(direccion).not.toBe('');
    expect(ventas).not.toBe(direccion);
  });

  test('los cuatro tokens del acento cambian juntos — son uno solo', async ({ page }) => {
    await page.goto(RUTAS.direccion);
    const [primary, accent, ring, glow] = await Promise.all([
      token(page, '#contenido', '--primary'),
      token(page, '#contenido', '--accent'),
      token(page, '#contenido', '--ring'),
      token(page, '#contenido', '--glow'),
    ]);
    expect(new Set([primary, accent, ring, glow]).size).toBe(1);
  });

  test('el valor es un triplet HSL, no un hex — por eso lo hereda todo', async ({ page }) => {
    await page.goto(RUTAS.ventas);
    expect(await token(page, '#contenido', '--primary')).toMatch(/^[\d.]+ [\d.]+% [\d.]+%$/);
  });

  test('el acento se hereda de verdad en el contenido de otro handoff', async ({ page }) => {
    await page.goto(RUTAS.ventas);
    // El andamio de H1 pinta su etiqueta con `text-[hsl(var(--primary))]` y no
    // sabe nada de áreas: si se ve del color de Ventas, la herencia funciona.
    const color = await page
      .getByText('H6', { exact: true })
      .evaluate((el) => getComputedStyle(el).color);
    expect(color).toMatch(/^rgb/);
    expect(color).not.toBe('rgb(255, 255, 255)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio 3 — contraste AA (el barrido exhaustivo vive en color.test.ts)
// ════════════════════════════════════════════════════════════════════════════

test.describe('criterio 3 · el acento se lee', () => {
  test('el acento aplicado cumple 4.5:1 contra el fondo real de la página', async ({ page }) => {
    await page.goto(RUTAS.direccion);

    const ratio = await page.evaluate(() => {
      const lum = (rgb: string) => {
        const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
        const f = (v: number) => {
          const u = v / 255;
          return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };

      const sonda = document.createElement('span');
      sonda.style.color = 'hsl(var(--primary))';
      document.querySelector('#contenido')!.appendChild(sonda);
      const acento = lum(getComputedStyle(sonda).color);
      sonda.remove();

      const fondo = lum(getComputedStyle(document.documentElement).backgroundColor);
      return (Math.max(acento, fondo) + 0.05) / (Math.min(acento, fondo) + 0.05);
    });

    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio 4 — los estados semánticos NO siguen al acento
// ════════════════════════════════════════════════════════════════════════════

test.describe('criterio 4 · estados semánticos fijos', () => {
  test('success, warning, error e info son idénticos en dos áreas de colores distintos', async ({
    page,
  }) => {
    const leer = async (ruta: string) => {
      await page.goto(ruta);
      return page.locator('#contenido').first().evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          acento: cs.getPropertyValue('--primary').trim(),
          success: cs.getPropertyValue('--color-success').trim(),
          warning: cs.getPropertyValue('--color-warning').trim(),
          error: cs.getPropertyValue('--color-error').trim(),
          info: cs.getPropertyValue('--color-info').trim(),
        };
      });
    };

    const ventas = await leer(RUTAS.ventas);
    const direccion = await leer(RUTAS.direccion);

    // El acento sí cambió…
    expect(ventas.acento).not.toBe(direccion.acento);

    // …y los cuatro semánticos NO. "Activo" no puede volverse rojo dentro de un
    // área roja.
    expect(ventas.success).toBe(direccion.success);
    expect(ventas.warning).toBe(direccion.warning);
    expect(ventas.error).toBe(direccion.error);
    expect(ventas.info).toBe(direccion.info);

    // Y siguen siendo lo que dicen ser.
    expect(Number(ventas.success.split(' ')[0])).toBeGreaterThan(90); // verde
    expect(Number(ventas.success.split(' ')[0])).toBeLessThan(180);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio 5 — un área bloqueada: candado, promesa, y NO clickeable
// ════════════════════════════════════════════════════════════════════════════

test.describe('criterio 5 · áreas bloqueadas', () => {
  test('se ve con su promesa y no es un enlace', async ({ page }) => {
    await page.goto(RUTAS.ventas);
    const nav = await abrirNav(page);

    // Se MUESTRA — no se esconde.
    await expect(nav.getByText('Onboarding', { exact: true })).toBeVisible();

    // Con su promesa.
    await expect(nav.getByText('Cómo se siente un cliente que entra a tu negocio.')).toBeVisible();

    // Y qué falta para abrirla.
    await expect(nav.getByText(/cierras tu primera venta/i)).toBeVisible();

    // NO es clickeable: ni enlace, ni botón, y marcada como deshabilitada.
    const fila = nav.locator('li', { hasText: 'Onboarding' }).last();
    await expect(fila.locator('a')).toHaveCount(0);
    await expect(fila.locator('button')).toHaveCount(0);
    await expect(fila.locator('[aria-disabled="true"]')).toHaveCount(1);
  });

  test('las áreas abiertas sí son enlaces — el contraste demuestra la diferencia', async ({
    page,
  }) => {
    await page.goto(RUTAS.ventas);
    const nav = await abrirNav(page);
    await expect(nav.locator('li', { hasText: 'Dirección' }).first().locator('a').first()).toBeVisible();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio 6 — LoadError y EmptyState, distinguibles a simple vista
// ════════════════════════════════════════════════════════════════════════════

test.describe('criterio 6 · estados honestos', () => {
  // El interruptor por cookie del layout es sólo-desarrollo a propósito: una
  // cookie no puede falsear estados en producción. Contra un build de
  // producción estas pruebas no aplican, y decirlo es más honesto que fingir
  // que pasaron.
  test.skip(
    () => process.env.SHELL_DEMO !== '1',
    'requiere el servidor de desarrollo (SHELL_DEMO=1)',
  );

  /**
   * El estado se fuerza con la cabecera `Cookie`, no con `context.addCookies`:
   * lo lee un componente de SERVIDOR, así que lo único que importa es que viaje
   * en la petición del documento. Además así no hay que acertarle al origen —
   * el error que tenía esta prueba era una cookie clavada al puerto 3100
   * mientras el servidor corría en otro.
   */
  const conEstado = async (page: Page, valor: string) => {
    await page.setExtraHTTPHeaders({ Cookie: `abraxa_shell_demo=${valor}` });
    await page.goto(RUTAS.ventas);
    return abrirNav(page);
  };

  test('cuando la carga falla sale un error con causa y reintento — no un cero', async ({
    page,
  }) => {
    const nav = await conEstado(page, 'error');

    const alerta = nav.getByRole('alert');
    await expect(alerta).toBeVisible();
    await expect(alerta).toContainText('Falló de nuestro lado');
    await expect(alerta.getByRole('button', { name: 'Reintentar' })).toBeVisible();

    // Y NO finge que no hay nada.
    await expect(nav.getByText('Aún no tienes áreas')).toHaveCount(0);
  });

  test('cuando de verdad no hay nada sale un estado vacío, sin alarma', async ({ page }) => {
    const nav = await conEstado(page, 'vacio');

    await expect(nav.getByText('Aún no tienes áreas')).toBeVisible();

    // No es una alerta: nada falló.
    await expect(nav.getByRole('alert')).toHaveCount(0);
  });

  test('los dos estados se ven distintos a simple vista', async ({ page }) => {
    const bordeDe = async (valor: string, texto: string) => {
      const nav = await conEstado(page, valor);
      return nav
        .locator('div')
        .filter({ hasText: texto })
        .last()
        .evaluate((el) => getComputedStyle(el).borderColor);
    };

    const error = await bordeDe('error', 'Falló de nuestro lado');
    const vacio = await bordeDe('vacio', 'Aún no tienes áreas');
    expect(error).not.toBe(vacio);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio 7 — responsive real
// ════════════════════════════════════════════════════════════════════════════

test.describe('criterio 7 · responsive', () => {
  test('en escritorio la barra es permanente', async ({ page }, info) => {
    test.skip(info.project.name !== 'escritorio', 'sólo aplica al proyecto de escritorio');
    await page.goto(RUTAS.ventas);
    await expect(page.getByRole('complementary', { name: 'Navegación principal' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Abrir las áreas/ })).toBeHidden();
  });

  test('en móvil la barra colapsa y se abre en un cajón, sin romper el contenido', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'movil', 'sólo aplica al proyecto móvil');
    await page.goto(RUTAS.ventas);

    await expect(page.getByRole('complementary', { name: 'Navegación principal' })).toBeHidden();

    // El contenido no se desborda horizontalmente.
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde).toBeLessThanOrEqual(1);

    // El cajón abre, atrapa el foco y cierra con Escape.
    const abrir = page.getByRole('button', { name: /Abrir las áreas/ });
    await expect(abrir).toBeVisible();
    await abrir.click();

    const cajon = page.getByRole('dialog');
    await expect(cajon).toBeVisible();
    await expect(cajon.getByText('Ventas y Marketing')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(cajon).toBeHidden();
  });

  test('el objetivo táctil del menú es de al menos 44 px', async ({ page }, info) => {
    test.skip(info.project.name !== 'movil', 'sólo aplica al proyecto móvil');
    await page.goto(RUTAS.ventas);
    const caja = await page.getByRole('button', { name: /Abrir las áreas/ }).boundingBox();
    expect(caja!.width).toBeGreaterThanOrEqual(44);
    expect(caja!.height).toBeGreaterThanOrEqual(44);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio 8 — prefers-reduced-motion
// ════════════════════════════════════════════════════════════════════════════

test.describe('criterio 8 · movimiento reducido', () => {
  // `emulateMedia` en la propia prueba, y no `reducedMotion` en el proyecto:
  // la opción del proyecto no llegaba al navegador —`matchMedia` devolvía
  // false— y la prueba habría pasado por el motivo equivocado. Así además cada
  // prueba declara su propia precondición y corre en cualquier ancho.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('la emulación está de verdad activa', async ({ page }) => {
    await page.goto(RUTAS.direccion);
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(true);
  });

  test('ninguna animación sigue corriendo', async ({ page }) => {
    await page.goto(RUTAS.direccion);
    const vivas = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && (a.effect?.getTiming().duration ?? 0) > 100)
          .length,
    );
    expect(vivas).toBe(0);
  });

  test('el punto de estado en vivo deja de latir pero sigue visible', async ({ page }) => {
    await page.goto(RUTAS.direccion);

    const punto = page.locator('.status-dot-live').first();
    await expect(punto).toBeAttached();

    const { animation, opacity } = await punto.evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      return { animation: before.animationName, opacity: Number(before.opacity) };
    });

    expect(animation).toBe('none');
    // Apagar la animación no puede volverlo invisible.
    expect(opacity).toBeGreaterThan(0.2);
  });
});
