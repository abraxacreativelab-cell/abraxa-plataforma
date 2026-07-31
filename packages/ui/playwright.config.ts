import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Verificación visual del shell — los criterios 1, 2, 3, 4, 5, 6, 7 y 8 del
 * handoff H5.
 *
 * Van en Playwright y no en vitest porque son afirmaciones sobre lo que se ve
 * en un navegador de verdad: que la barra colapsa, que un área bloqueada no se
 * puede abrir, que el acento cambia. Un DOM simulado no prueba nada de eso, y
 * además ni `jsdom` ni testing-library están instalados (regla 4: nadie instala
 * dependencias).
 *
 *     npx playwright test -c packages/ui/playwright.config.ts
 *
 * Con un servidor ya levantado, se reutiliza:
 *
 *     BASE_URL=http://127.0.0.1:3111 npx playwright test -c packages/ui/playwright.config.ts
 */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.resultados',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? 'line'
    : [['list'], ['html', { outputFolder: './e2e/.reporte', open: 'never' }]],

  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tableta',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'movil',
      // `browserName` explícito: `devices['iPhone 13']` trae WebKit, y lo que se
      // verifica aquí es el ANCHO y el táctil, no el motor. Forzar Chromium
      // evita pedir un segundo navegador para probar lo mismo.
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  // No hay proyecto de "movimiento reducido": la opción `reducedMotion` del
  // proyecto NO llegaba al navegador (`matchMedia` devolvía false) y la prueba
  // habría pasado por el motivo equivocado. Ahora esas pruebas piden la
  // emulación ellas mismas con `page.emulateMedia()`, y corren en los tres
  // anchos en vez de en uno.

  webServer: {
    // `cwd` explícito: sin esto, Playwright arranca el comando desde el
    // directorio del config (packages/ui) y `--workspace apps/web` no existe
    // desde ahí.
    cwd: RAIZ,
    command: 'npm run dev --workspace apps/web',
    // La misma URL que `baseURL`, o Playwright levanta un segundo servidor
    // aunque ya haya uno arriba.
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { WEB_PORT: new URL(BASE).port || '3000' },
  },
});
