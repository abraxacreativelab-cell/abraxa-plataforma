import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `domain/` es lo único que viaja al navegador, y la única manera de que siga
 * siendo cierto es comprobarlo.
 *
 * Un `import { tenantDb } from '@abraxa/db'` puesto de buena fe dentro de
 * `domain/` metería el cliente de Supabase entero en el paquete del cliente sin
 * que nadie lo notara hasta ver el peso del bundle. Esta prueba lo caza en el
 * momento.
 */
const DIR = dirname(fileURLToPath(import.meta.url));

const PROHIBIDOS = [
  { patron: /from\s+['"]@abraxa\/db['"]/, razon: 'arrastra el cliente de Supabase al navegador' },
  { patron: /from\s+['"]express['"]/, razon: 'es del servidor' },
  { patron: /from\s+['"]\.\.\/services\//, razon: 'los servicios hablan con la base de datos' },
  { patron: /from\s+['"]\.\.\/data\//, razon: 'la capa de datos habla con la base de datos' },
  { patron: /from\s+['"]zod['"]/, razon: 'la validación de la red es de services/, no del dominio' },
  { patron: /from\s+['"]react['"]/, razon: 'el dominio es puro: la pantalla vive en apps/web' },
];

const archivos = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('domain/ se mantiene puro', () => {
  it('hay archivos que revisar (si esto falla, el patrón dejó de encontrarlos)', () => {
    expect(archivos.length).toBeGreaterThan(5);
  });

  it.each(archivos)('%s no importa nada del servidor', (archivo) => {
    const fuente = readFileSync(join(DIR, archivo), 'utf8');
    for (const { patron, razon } of PROHIBIDOS) {
      expect(patron.test(fuente), `${archivo} importa algo prohibido: ${razon}`).toBe(false);
    }
  });
});
