import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

/**
 * Empaqueta la API a un solo archivo ESM.
 *
 * Los paquetes de `packages/*` se consumen como FUENTE (patrón "internal
 * package") y esbuild los mete al bundle. Así nadie pelea con `dist/` por
 * paquete, extensiones `.js` en los imports, ni orden de compilación entre 12
 * paquetes — una clase entera de fallas que, multiplicada por 14 carriles,
 * costaría días.
 *
 * Los `@abraxa/*` SE EMPAQUETAN (son TypeScript sin compilar).
 * Todo lo demás queda externo: bundle chico y binarios nativos intactos.
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@abraxa/'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
});
