// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * El mensaje que ve quien rompe la regla del cliente crudo.
 * Se explica solo: la conversación que lo topa se corrige sin preguntarle a nadie.
 */
const RAW_CLIENT_MESSAGE = [
  'Prohibido el cliente crudo de Supabase fuera de packages/db.',
  'Usa tenantDb(ctx) de @abraxa/db: aísla por tenant_id en el tipo, no por convención.',
  'GARDEN dejó 145 de 170 tablas sin RLS y el aislamiento colgando de 447 .eq() escritos a mano.',
  'Si de verdad necesitas acceso sin filtrar (alta de tenants, tablas globales), usa adminDb()',
  'y deja un comentario diciendo por qué.',
].join(' ');

const ADMIN_DB_MESSAGE = [
  'adminDb() no va en routes/ ni en services/: ahí todo dato de dominio pasa por tenantDb(ctx).',
  'adminDb() es sólo para alta de tenants y tablas globales (app.users, app.plans,',
  'app.industry_templates, app.billing_events), y vive en el servicio que las administra.',
].join(' ');

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.d.ts',
      'apps/web/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // La regla que sostiene el aislamiento entre clientes.
  // packages/db es el único lugar donde puede existir un cliente de Supabase.
  // ─────────────────────────────────────────────────────────────────────────
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    ignores: ['packages/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@supabase/supabase-js', message: RAW_CLIENT_MESSAGE },
            { name: 'pg', message: RAW_CLIENT_MESSAGE },
          ],
          patterns: [
            { group: ['**/db/src/client', '**/db/src/client.js'], message: RAW_CLIENT_MESSAGE },
          ],
        },
      ],
    },
  },

  // Dentro de routes/ y services/ ni siquiera adminDb: todo por tenantDb(ctx).
  {
    files: ['packages/*/src/routes/**/*.ts', 'packages/*/src/services/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@supabase/supabase-js', message: RAW_CLIENT_MESSAGE },
            { name: 'pg', message: RAW_CLIENT_MESSAGE },
            { name: '@abraxa/db', importNames: ['adminDb', 'serviceClient'], message: ADMIN_DB_MESSAGE },
          ],
        },
      ],
    },
  },

  // El paquete de UI corre en el navegador.
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Los guiones de infraestructura pueden hablar por consola.
  {
    files: ['scripts/**/*.{mjs,js,ts}', '**/build.mjs', '**/*.config.{mjs,ts}'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
);
