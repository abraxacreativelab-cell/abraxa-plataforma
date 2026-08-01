import { createHash } from 'node:crypto';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El nombre de la empresa de un invitado que entra por primera vez.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Vive aparte de `sesion.ts` a propósito: son funciones puras, sin
 *  `next/headers` ni `fetch`, así que se pueden ejecutar y verificar solas. La
 *  configuración de vitest (`vitest.config.ts`, de H1) sólo recoge pruebas bajo
 *  `apps/<app>/src/`, y `apps/web` no tiene `src/`, así que estas dos funciones
 *  no las puede correr el runner del repo — pero sí un `esbuild` + `node`, y su
 *  salida está en el PR.
 *
 *  ── Por qué el slug lleva una huella y no sólo el nombre ──────────────────
 *
 *  Porque de eso depende que dos invitados del evento NO caigan en la misma
 *  empresa. `ana@gmail.com` y `ana@hotmail.com` comparten la parte legible y
 *  no la huella, así que piden slugs distintos. Y como el mismo correo produce
 *  siempre el mismo slug, entrar dos veces no crea dos empresas: `provision()`
 *  devuelve la misma.
 *
 *  Si dos correos distintos llegaran a pedir el mismo slug —haría falta que
 *  coincidieran la parte legible Y los 6 hex de SHA-256 del correo completo— el
 *  alta no los junta: `provision()` lanza CONFLICT cuando el slug ya es de otra
 *  persona, y el Ritual enseña la pantalla de "falta tu empresa". Nunca abre la
 *  empresa de alguien más.
 */

/**
 * El slug de la empresa de este correo. Determinista, y sólo suyo.
 *
 * Cumple `SLUG_RE` de `@abraxa/tenancy` (`^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`):
 * la parte legible se recorta a 24, se le quita cualquier guion de los bordes y
 * se le pega `-` + 6 hex. Mínimo 8 caracteres, máximo 31.
 */
export function slugParaElCorreo(userEmail: string): string {
  const local = userEmail.split('@')[0] ?? '';
  const legible =
    local
      .toLowerCase()
      .normalize('NFD')
      // Los diacríticos combinantes: "José" → "jose", no "jos-".
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 24)
      .replace(/-+$/, '') || 'empresa';

  const huella = createHash('sha256').update(userEmail).digest('hex').slice(0, 6);
  return `${legible}-${huella}`;
}

/**
 * Un nombre presentable mientras el Ritual no descubra el de verdad.
 *
 * Se capitaliza palabra por palabra y NO con `\b\p{L}`: `\b` es una frontera
 * ASCII, así que con un acento en medio partía la palabra y salía «JosÉ RamÍRez»
 * en la cabecera de su propia empresa. Es el nombre que el invitado va a leer
 * en pantalla antes de contarle nada a su agente.
 */
export function nombreParaElCorreo(userEmail: string): string {
  const local = (userEmail.split('@')[0] ?? '')
    .replace(/[+._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (local.length < 2) return 'Mi empresa';

  return local
    .split(' ')
    .map((p) => p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es'))
    .join(' ')
    .slice(0, 120);
}
