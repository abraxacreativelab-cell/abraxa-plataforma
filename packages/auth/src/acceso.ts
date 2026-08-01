/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Quién tiene permiso de entrar. Hoy: cualquiera con una cuenta de Google.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── Por qué la allowlist vacía significa "todos" ───────────────────────────
 *
 *  Al revés —vacía significa "nadie"— es el default que parece más seguro y es
 *  el que rompe el evento: nadie sabe de antemano con qué correo va a llegar
 *  cada invitado. La mitad trae dos cuentas de Google abiertas en el teléfono y
 *  elige la que le sale primero. Una lista escrita a mano deja fuera a gente
 *  real delante de todos, y no hay forma de arreglarlo en el momento sin tocar
 *  el `.env` del VPS y reiniciar.
 *
 *  Y no deja la puerta abierta de par en par: para llegar aquí hay que haber
 *  pasado por Google y haber vuelto con un `id_token` verificado. Lo que se
 *  decide en este archivo es "de los que Google ya autenticó, ¿cuáles pasan?",
 *  no "¿quién entra sin credenciales?".
 *
 *  Poner `AUTH_ALLOWED_EMAILS` cierra la puerta a esa lista exacta, y es lo que
 *  hay que hacer el día que esto deje de ser una demo. Está documentado en
 *  `packages/auth/README.md`, es una variable de entorno y no un despliegue.
 *
 *  ── Y por qué es un módulo aparte de `entorno.ts` ──────────────────────────
 *
 *  Porque es una POLÍTICA, no una lectura de configuración. `entorno.ts` dice
 *  qué hay puesto; esto dice qué se hace con ello. Separarlos es lo que permite
 *  que `acceso.test.ts` pruebe la política entera pasando un objeto literal, sin
 *  tocar `process.env` — que es exactamente la clase de prueba que se contamina
 *  entre archivos cuando corren en paralelo.
 */

/** Sólo lo que hace falta de `process.env`. Nunca `NodeJS.ProcessEnv`. */
export type Entorno = Record<string, string | undefined>;

const entornoActual = (): Entorno => process.env as Entorno;

/**
 * El correo, normalizado igual que en `app.users`, o `''` si no es un correo.
 *
 * Devolver `''` y no lanzar es deliberado: quien llama está dentro del callback
 * de OAuth de Google, y una excepción ahí se ve como una pantalla de error de
 * Google que no dice nada. Una cadena vacía es un `false` limpio en
 * `puedeEntrar()` y un mensaje honesto más arriba.
 *
 * La validación es mínima a propósito —hay algo antes de la arroba y algo
 * después— porque el correo ya lo verificó Google. Aquí no se está validando
 * un formulario: se está descartando la basura evidente (`''`, `'sin-arroba'`,
 * `'@'`) que sí llegaría si el perfil viniera con una forma inesperada.
 */
export function normalizarCorreo(correo: string | null | undefined): string {
  const limpio = (correo ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(limpio) ? limpio : '';
}

/**
 * La allowlist, ya partida y normalizada. Vacía cuando no hay ninguna.
 *
 * Se normaliza igual que el correo entrante —minúsculas y sin espacios— porque
 * quien escribe la variable en el `.env` del VPS la escribe a mano, y
 * `Santiago@Abraxa.club` tiene que dejar entrar a `santiago@abraxa.club`. Una
 * allowlist que falla por una mayúscula no se diagnostica: parece que el login
 * está roto.
 */
export function correosPermitidos(env: Entorno = entornoActual()): string[] {
  return (env.AUTH_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
}

/**
 * ¿Este correo entra?
 *
 * Un correo inválido no entra NUNCA, ni siquiera si aparece literalmente en la
 * allowlist: la lista dice a quién se le abre la puerta, no qué cuenta como
 * correo. Si `'sin-arroba'` entrara por estar listado, `normalizarCorreo()`
 * dejaría de ser el único sitio donde se decide qué es una identidad.
 */
export function puedeEntrar(
  correo: string | null | undefined,
  env: Entorno = entornoActual(),
): boolean {
  const email = normalizarCorreo(correo);
  if (!email) return false;

  const permitidos = correosPermitidos(env);
  return permitidos.length === 0 || permitidos.includes(email);
}
