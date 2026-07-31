import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cada handoff pone sus pruebas dentro de su propio paquete. Nadie edita
    // este archivo: el patrón ya las recoge todas.
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/e2e/**'],
    environment: 'node',
    passWithNoTests: true,
  },
});
