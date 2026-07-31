/**
 * Log mínimo del paquete. Misma forma que el de H3, por la misma razón: un
 * paquete de dominio no debería imponerle su transporte de logs al proceso que
 * lo hospeda.
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
  const linea = `[inbox] ${msg}`;
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
