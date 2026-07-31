/**
 * Guardar y restaurar las variables de entorno de una prueba, UNA POR UNA.
 *
 * ── Por qué no `process.env = { ...copia }` ────────────────────────────────
 *
 * Porque reemplazar el objeto entero deja uno que ya NO es el del proceso, y
 * eso rompe cosas que no tienen nada que ver con la prueba: está documentado en
 * este repo (`packages/agents/src/routes.test.ts`, citado por
 * `packages/crm/src/routes.test.ts`) que a partir de ahí los POST contra un
 * servidor de prueba se quedan colgados y la suite parece un fantasma.
 *
 * Este paquete tiene pruebas que levantan un servidor HTTP real Y pruebas que
 * mueven `INTEGRATIONS_KEY` en cada caso, así que aquí ese atajo no es una
 * cuestión de estilo: sería una tarde perdida buscando el fantasma.
 */

/** Las variables que este paquete toca. Explícitas, para no restaurar de más. */
export const VARIABLES = [
  'INTEGRATIONS_KEY',
  'INTEGRATIONS_KEY_2',
  'INTEGRATIONS_KEY_3',
  'INTEGRATIONS_PLATFORM_FALLBACK',
  'RESEND_API_KEY',
  'RESEND_FROM_DOMAIN',
  'EVOLUTION_API_URL',
  'EVOLUTION_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
  'META_APP_SECRET',
  'META_VERIFY_TOKEN',
  'PROXY_SECRET',
  'NODE_ENV',
] as const;

/**
 * Toma una foto de esas variables y devuelve la función que las repone.
 *
 * Reponer es poner el valor que había o BORRAR la que no existía: dejar una
 * `INTEGRATIONS_KEY` puesta después de la prueba que comprueba el fail-closed
 * haría pasar por casualidad a la siguiente.
 */
export function capturarEntorno(): () => void {
  const foto = new Map<string, string | undefined>();
  for (const clave of VARIABLES) foto.set(clave, process.env[clave]);

  return () => {
    for (const [clave, valor] of foto) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  };
}

/** Borra las variables del paquete, para arrancar cada caso desde cero. */
export function limpiarEntorno(): void {
  for (const clave of VARIABLES) {
    if (clave !== 'NODE_ENV') delete process.env[clave];
  }
}
