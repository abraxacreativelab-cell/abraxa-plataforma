/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las variables de los mensajes.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      "Hola {nombre}, tu cita es el {fecha} a las {hora}. Cuesta {precio.hora}."
 *
 *  ── Una sola pasada, y por qué importa ─────────────────────────────────────
 *
 *  La tentación es encadenar: primero mis variables, luego `VaultPort.render()`
 *  para los `{valor.*}`. No se puede: el contrato de `render()` dice que un
 *  token desconocido queda VACÍO — así que la segunda pasada se comería
 *  cualquier `{nombre}` que la primera no hubiera resuelto, y al revés, la
 *  bóveda pasando primero borraría todas las mías.
 *
 *  Por eso se pide `VaultPort.resolve()` —que devuelve el MAPA, no el texto
 *  renderizado— se junta con las mías, y se renderiza UNA vez. Ese es el
 *  motivo por el que este archivo no llama a `render()` aunque exista: no es
 *  que no se haya visto.
 *
 *  ── Best effort, sin excepción ─────────────────────────────────────────────
 *
 *  Si la bóveda o el CRM fallan, se devuelve lo que se tenga. Un mensaje que
 *  sale con un hueco es un problema; un seguimiento que no sale porque el
 *  resolvedor de precios tuvo un mal minuto es otro mucho peor.
 */
import { tryPort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { contactos } from './crm';
import type { RunContext } from './types';

export type Variables = Record<string, string>;

const ZONA = 'America/Mexico_City';

export const fmtFecha = (iso: string, tz = ZONA): string =>
  new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: tz,
  }).format(new Date(iso));

export const fmtHora = (iso: string, tz = ZONA): string =>
  new Intl.DateTimeFormat('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  }).format(new Date(iso));

/**
 * Sustituye `{variable}`. Lo que no conozca queda VACÍO.
 *
 * Nunca deja un `{token}` crudo en la cara del cliente final: un WhatsApp que
 * dice "Hola {nombre}" es peor que uno que dice "Hola". Es el mismo criterio
 * de `VaultPort.render()`.
 *
 * Función pura: se prueba sin puertos, sin base y sin red.
 */
export function renderizar(plantilla: string, vars: Variables): string {
  return String(plantilla ?? '').replace(
    /\{([\wáéíóúñÁÉÍÓÚÑ.-]+)\}/g,
    (_, clave: string) => vars[clave] ?? '',
  );
}

/** Las variables que salen del contexto del evento, sin pedirle nada a nadie. */
export function variablesDelContexto(contexto: RunContext, ahora = new Date()): Variables {
  const vars: Variables = {
    fecha: fmtFecha(ahora.toISOString()),
    hora: fmtHora(ahora.toISOString()),
  };

  // Todo escalar del payload queda disponible con su propio nombre: así un
  // disparador nuevo trae sus datos sin que este archivo tenga que enterarse.
  for (const [k, v] of Object.entries(contexto)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    vars[k] = String(v);
  }
  return vars;
}

/**
 * Junta todo lo que se puede interpolar: el contexto, el contacto y la bóveda.
 *
 * `tryPort`/`contactos()` y no `usePort`: este camino corre DENTRO de un envío
 * al cliente final. Si la bóveda no ha aterrizado, el mensaje sale sin
 * `{precio.*}`; no se cae.
 */
export async function construirVariables(
  ctx: TenantContext,
  contexto: RunContext,
  ahora = new Date(),
): Promise<Variables> {
  const vars = variablesDelContexto(contexto, ahora);

  const contactId = typeof contexto.contactId === 'string' ? contexto.contactId : null;
  if (contactId) {
    try {
      const contacto = await contactos()?.get(ctx, contactId);
      if (contacto) {
        const completo = contacto.displayName ?? '';
        vars.nombre = contacto.firstName ?? completo.split(' ')[0] ?? '';
        vars.nombre_completo = completo;
        vars.empresa_contacto = contacto.companyName ?? '';
        vars.responsable = contacto.ownerEmail ?? '';
        vars.vendedor = contacto.ownerEmail ? (contacto.ownerEmail.split('@')[0] ?? '') : '';
        vars.etapa = contacto.placements[0]?.stageName ?? '';
        for (const [k, v] of Object.entries(contacto.custom)) {
          if (v !== null && v !== undefined && typeof v !== 'object') vars[`custom.${k}`] = String(v);
        }
      }
    } catch {
      /* best effort: ver la cabecera */
    }
  }

  try {
    // `resolve()` y no `render()`: hace falta el MAPA para poder renderizar
    // una sola vez. Ver la cabecera.
    const boveda = await tryPort('vault')?.resolve(ctx);
    if (boveda) Object.assign(vars, boveda);
  } catch {
    /* best effort */
  }

  return vars;
}
