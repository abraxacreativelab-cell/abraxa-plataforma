/**
 * Log mínimo del paquete.
 *
 * Sin dependencias a propósito. H1 instaló `pino` para `apps/api`, pero un
 * paquete de dominio no debería imponer su transporte de logs al proceso que lo
 * hospeda: escribe a la consola con un prefijo y ya. Si algún día se quiere
 * estructurado, se sustituye este archivo y nadie más se entera.
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
  const linea = `[agents] ${msg}`;
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
