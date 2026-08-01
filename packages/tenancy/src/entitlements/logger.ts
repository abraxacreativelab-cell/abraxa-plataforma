/**
 * Log mínimo del subárbol de entitlements.
 *
 * Mismo criterio y misma forma que `packages/agents/src/logger.ts`: sin
 * dependencias, con prefijo propio. Un paquete de dominio no le impone su
 * transporte de logs al proceso que lo hospeda.
 *
 * Aquí importa más que en otros lados: las dos líneas que este módulo escribe
 * —un job omitido y un registro de omisión que no se pudo guardar— son la única
 * señal de que el producto decidió NO hacer algo. Un sistema que calla cuando
 * decide no actuar es indistinguible de uno roto.
 */
/* eslint-disable no-console -- es el logger; escribir a la consola es su trabajo. */
type Nivel = 'debug' | 'info' | 'warn' | 'error';

const ORDEN: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function nivelActivo(): number {
  const v = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (v === 'trace') return ORDEN.debug;
  if (v === 'fatal') return ORDEN.error;
  return ORDEN[v as Nivel] ?? ORDEN.info;
}

function emitir(nivel: Nivel, msg: string): void {
  if (ORDEN[nivel] < nivelActivo()) return;
  const linea = `[entitlements] ${msg}`;
  if (nivel === 'error') console.error(linea);
  else if (nivel === 'warn') console.warn(linea);
  else console.log(linea);
}

export const log = {
  debug: (m: string): void => emitir('debug', m),
  info: (m: string): void => emitir('info', m),
  warn: (m: string): void => emitir('warn', m),
  error: (m: string): void => emitir('error', m),
};
