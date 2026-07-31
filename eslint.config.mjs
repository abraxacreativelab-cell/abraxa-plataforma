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

/**
 * El agujero que cerró H0 el 2026-07-31.
 *
 * `packages/db/src/index.ts:6` re-exporta `serviceClient()` —el cliente con
 * service_role, que hace BYPASS de RLS— y hasta hoy NINGUNA regla impedía
 * importarlo desde cualquier paquete. La promesa de H1 ("el aislamiento no
 * depende de disciplina, está en el lint") era falsa para el peor caso: la
 * regla existente sólo tapaba `@supabase/supabase-js`, `pg` y la ruta profunda
 * al módulo `client` — no el nombre re-exportado por la puerta principal.
 *
 * Verificado antes de poner la regla: `serviceClient` no se usa en ningún lado
 * fuera de packages/db (ni en main, ni en el PR #6, ni en el PR #7). Prohibirlo
 * no rompe nada — sólo cierra la puerta antes de que alguien la use.
 */
const SERVICE_CLIENT_MESSAGE = [
  'serviceClient() hace BYPASS de RLS y es privado de packages/db.',
  'Usa tenantDb(ctx) para datos de negocio. Si de verdad necesitas acceso sin filtrar',
  '(alta de tenants, tablas globales), usa adminDb() y deja escrito por qué.',
  'RLS es la red de abajo; tenantDb(ctx) es la de arriba. Sin las dos, GARDEN otra vez.',
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
            // El bypass de RLS por su nombre, entrando por la puerta principal.
            {
              name: '@abraxa/db',
              importNames: ['serviceClient'],
              message: SERVICE_CLIENT_MESSAGE,
            },
          ],
          patterns: [
            { group: ['**/db/src/client', '**/db/src/client.js'], message: RAW_CLIENT_MESSAGE },
            // …y por la puerta de atrás: importar el barril por ruta profunda
            // era la forma de saltarse `importNames` sin que nadie se enterara.
            {
              group: ['**/db/src/index', '**/db/src/index.js', '**/packages/db/src/**'],
              message: SERVICE_CLIENT_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // Dentro de routes/ y services/ ni siquiera adminDb: todo por tenantDb(ctx).
  //
  // `packages/*/src/routes.ts` está en la lista además de `routes/**` porque un
  // paquete chico expone sus rutas en UN archivo, no en una carpeta —
  // packages/agents/src/routes.ts es exactamente ese caso, y quedaba fuera de
  // la regla por una barra.
  {
    files: [
      'packages/*/src/routes.ts',
      'packages/*/src/routes/**/*.ts',
      'packages/*/src/services.ts',
      'packages/*/src/services/**/*.ts',
      'apps/*/src/routes.ts',
      'apps/*/src/routes/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@supabase/supabase-js', message: RAW_CLIENT_MESSAGE },
            { name: 'pg', message: RAW_CLIENT_MESSAGE },
            { name: '@abraxa/db', importNames: ['adminDb', 'serviceClient'], message: ADMIN_DB_MESSAGE },
          ],
          patterns: [
            { group: ['**/db/src/client', '**/db/src/client.js'], message: RAW_CLIENT_MESSAGE },
            {
              group: ['**/db/src/index', '**/db/src/index.js', '**/packages/db/src/**'],
              message: SERVICE_CLIENT_MESSAGE,
            },
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
