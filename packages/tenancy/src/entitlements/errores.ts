/**
 * ════════════════════════════════════════════════════════════════════════════
 *  402 contra 403 — no es cosmético.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Las tres respuestas se ven parecidas desde el servidor y son tres pantallas
 * DISTINTAS para el emprendedor:
 *
 *   Tu plan no incluye esto            402  "Esto viene en el plan Pro"
 *   Tu plan sí, pero tú no tienes      403  "Pídele acceso al dueño"
 *   Sí lo tienes, pero ya te pasaste   409  "Llegaste a 500 contactos"
 *
 * Un 403 cuando en realidad NO CONTRATÓ manda al emprendedor a buscar a un
 * administrador que no existe: él *es* el dueño. Y ése es el momento exacto en
 * que le escribe a soporte por algo que la pantalla correcta le habría cobrado.
 *
 * ── Lo que este carril todavía no puede hacer ──────────────────────────────
 *
 * `PlatformErrorCode` es una unión cerrada en `packages/db/ports.ts:109-120` y
 * ese archivo es de H1: el gate de propiedad falla el PR si lo tocamos (regla 3
 * de CONTRIBUTING.md). El código que hace falta —`FEATURE_NOT_IN_PLAN`— tiene
 * que agregarlo H1.
 *
 * Mientras tanto, y sin esperar a nadie: se lanza `BUDGET_EXCEEDED`, que YA
 * mapea a 402 en `packages/db/src/errors.ts:3-15`, con `details.reason` que
 * dice de qué 402 se trata. El HTTP que ve el navegador es el correcto desde el
 * día uno, y `details.reason` es lo que la UI mira para elegir la pantalla.
 *
 * Cuando H1 agregue el código, se cambia `CODIGO_NO_CONTRATADO` en ESTE archivo
 * y ningún llamador se entera. Ésa es toda la razón por la que la constante
 * existe en vez de estar escrita en línea en tres lugares.
 */
import { PlatformError } from '@abraxa/db';
import type { PlatformErrorCode } from '@abraxa/db/ports';

/**
 * El código con el que sale "tu plan no incluye esto".
 *
 * Hoy: `BUDGET_EXCEEDED` (402) + `details.reason='feature_not_in_plan'`.
 * Mañana, cuando H1 agregue `FEATURE_NOT_IN_PLAN` a `PlatformErrorCode` y
 * `FEATURE_NOT_IN_PLAN: 402` a `STATUS`, se cambia esta línea y nada más.
 *
 * Anotado en el PR como enganche #1 de §11 del handoff.
 */
export const CODIGO_NO_CONTRATADO: PlatformErrorCode = 'BUDGET_EXCEEDED';

/** El discriminante que la UI lee para saber QUÉ 402 es. */
export const RAZON_NO_CONTRATADO = 'feature_not_in_plan' as const;

/** El discriminante del otro 402 — el de H3, que ya existe. */
export const RAZON_PRESUPUESTO = 'budget' as const;

export interface DetalleNoContratado {
  reason: typeof RAZON_NO_CONTRATADO;
  feature: string;
  /** Copy de producto para la pantalla de mejora. Sale de `app.features.blurb`. */
  blurb?: string;
  label?: string;
}

/**
 * "Tu plan no incluye esto." 402.
 *
 * El `blurb` viaja en el error a propósito: la pantalla de mejora tiene que
 * poder decir qué se está perdiendo sin ir a buscarlo a otra petición. Es la
 * misma decisión que tomó H11 con las áreas bloqueadas (`ports.ts:AreaState`):
 * lo que no tienes se MUESTRA con su promesa.
 */
export function noContratado(
  feature: string,
  extra: { blurb?: string; label?: string } = {},
): PlatformError {
  const nombre = extra.label ?? feature;
  return new PlatformError(
    CODIGO_NO_CONTRATADO,
    `Tu plan no incluye ${nombre}.` + (extra.blurb ? ` ${extra.blurb}` : ''),
    {
      details: {
        reason: RAZON_NO_CONTRATADO,
        feature,
        ...(extra.blurb ? { blurb: extra.blurb } : {}),
        ...(extra.label ? { label: extra.label } : {}),
      } satisfies DetalleNoContratado,
    },
  );
}

/**
 * "Esta empresa no está activa." 403.
 *
 * Es 403 y no 402 a propósito: no es que no haya contratado la función — es que
 * la cuenta entera está detenida, y la pantalla que hay que enseñar es la de la
 * cuenta, no la de mejora de plan. Ofrecerle subir de plan a alguien suspendido
 * por falta de pago es la respuesta equivocada al problema que tiene.
 */
export function empresaNoActiva(reason: 'suspended' | 'archived' | 'unknown'): PlatformError {
  const mensaje =
    reason === 'suspended'
      ? 'Esta empresa está suspendida. Ponte al corriente para reactivarla; nada se ha borrado.'
      : reason === 'archived'
        ? 'Esta empresa está archivada.'
        : 'Esta empresa no existe.';

  return new PlatformError('FORBIDDEN', mensaje, { details: { reason } });
}

/** `true` si el error es un "no contratado" y no otro 402. */
export function esNoContratado(e: unknown): boolean {
  return (
    PlatformError.is(e) &&
    (e.details as { reason?: string } | undefined)?.reason === RAZON_NO_CONTRATADO
  );
}

export { PlatformError };
