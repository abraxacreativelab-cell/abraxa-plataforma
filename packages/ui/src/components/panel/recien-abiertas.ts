import type { AreaSummary } from '@abraxa/db/ports';
import { isNavigable } from '../nav/resolve-areas';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Qué se le abrió desde la última vez que estuvo aquí
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  «Y después, con esa motivación y las ganas de desbloquear todas las nuevas
 *   áreas, que siga con las preguntas más específicas.»
 *
 *  Eso sólo funciona si el desbloqueo SE VE. Un área que pasa de candado a
 *  abierta entre una visita y la siguiente, sin que nada lo señale, es una
 *  recompensa que el producto se guarda para sí mismo: el emprendedor contestó
 *  cinco preguntas incómodas y de vuelta encuentra la misma pantalla de antes.
 *
 *  ── Por qué se recuerda lo CERRADO y no lo abierto ─────────────────────────
 *
 *  Porque es lo único que no miente cuando la memoria no existe todavía.
 *
 *  Si se recordara lo abierto, la primera visita —sin nada guardado— tendría
 *  cero áreas conocidas y TODAS las abiertas parecerían recién abiertas: al
 *  invitado le explotaría la pantalla entera de confeti por haber entrado. Al
 *  recordar lo CERRADO, la primera visita tiene el conjunto vacío, nada estaba
 *  cerrado antes, y por lo tanto nada se acaba de abrir. Silencio, que es la
 *  respuesta correcta.
 *
 *  ── Por qué es una función pura y la memoria entra por argumento ───────────
 *
 *  Para poder probar el criterio sin un navegador. Lo que hay que poder
 *  verificar no es que `localStorage` funcione: es que nadie vea un festejo que
 *  no se ganó, y que quien sí se lo ganó lo vea UNA vez y no en cada recarga.
 */

/** Los slugs de las áreas que hoy están cerradas. Es lo que se guarda. */
export function slugsCerrados(areas: readonly AreaSummary[] | null): string[] {
  if (!areas) return [];
  return areas.filter((a) => !isNavigable(a)).map((a) => a.slug);
}

/**
 * Las que estaban cerradas la última vez y hoy están abiertas.
 *
 * `memoria` en `null` significa "no hay recuerdo de una visita anterior" —la
 * primera vez, o alguien que limpió su navegador— y devuelve vacío. Un festejo
 * en la primera visita no es un festejo, es ruido.
 */
export function areasRecienAbiertas(
  memoria: readonly string[] | null,
  areas: readonly AreaSummary[] | null,
): string[] {
  if (!memoria || memoria.length === 0 || !areas) return [];

  const cerradasAntes = new Set(memoria);
  return areas.filter((a) => isNavigable(a) && cerradasAntes.has(a.slug)).map((a) => a.slug);
}

/**
 * La llave de la memoria, por EMPRESA.
 *
 * Sin el slug de la empresa, un contador con dos negocios en el mismo navegador
 * vería el desbloqueo del cliente A festejado en el panel del cliente B. No es
 * una fuga de datos —sólo son slugs de área, los mismos cuatro para todos— pero
 * sí es el producto mintiéndole sobre su propio avance.
 */
export function llaveDeMemoria(tenantSlug: string | null | undefined): string {
  return `abraxa:areas-cerradas:${tenantSlug ?? 'sin-empresa'}`;
}

/**
 * Lee la memoria del navegador. Devuelve `null` si no hay ninguna, que es
 * distinto de un arreglo vacío ("estuvo aquí y no tenía nada cerrado").
 *
 * Nunca lanza: un `localStorage` bloqueado —modo privado de Safari, una
 * política de empresa, la cuota llena— no puede tumbar el panel por una
 * animación.
 */
export function leerMemoria(llave: string): string[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const crudo = localStorage.getItem(llave);
    if (!crudo) return null;

    const datos: unknown = JSON.parse(crudo);
    if (!Array.isArray(datos)) return null;
    return datos.filter((s): s is string => typeof s === 'string');
  } catch {
    return null;
  }
}

/** Guarda la memoria. Igual que arriba: falla en silencio y no rompe nada. */
export function guardarMemoria(llave: string, slugs: readonly string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(llave, JSON.stringify(slugs));
  } catch {
    /* Sin memoria no hay festejo. Es degradar, no fallar. */
  }
}
