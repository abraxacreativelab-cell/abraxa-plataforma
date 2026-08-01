/* eslint-disable no-console -- es el logger; escribir a la consola es su trabajo. */
/**
 * Log del Ritual. Mismo patrón mínimo que usa H3 en su carril: sin dependencias
 * y con prefijo propio, para que una línea del onboarding se distinga de una del
 * motor de agentes sin tener que adivinar.
 */
const prefijo = '[ritual]';

export const log = {
  info: (m: string): void => console.log(`${prefijo} ${m}`),
  warn: (m: string): void => console.warn(`${prefijo} ⚠ ${m}`),
  error: (m: string): void => console.error(`${prefijo} ✖ ${m}`),
};
