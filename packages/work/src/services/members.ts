/**
 * El equipo — regla 5 del contrato en una sola función.
 *
 * H9 necesita los miembros del tenant para el selector de responsable y para la
 * vista "por responsable". Los tiene H2, y H9 **no espera a H2**: programa
 * contra `TenancyPort.listMembers` y usa `tryPort`, que devuelve `null` cuando
 * nadie lo ha registrado todavía.
 *
 * Lo que se degrada es el equipo, no la pantalla. Sin H2 el emprendedor sigue
 * viendo sus tareas, creándolas y arrastrándolas; lo único que no aparece es la
 * pestaña "Responsable" — y eso es exactamente lo que pide el criterio 7:
 * *"sin equipo, la vista por responsable no estorba"*.
 *
 * `degraded` viaja hasta la interfaz porque la diferencia importa: "estás solo"
 * y "no pudimos leer tu equipo" no son la misma frase, y mostrar la primera
 * cuando pasó la segunda es la clase de mentira que cuesta la confianza.
 */
import { tryPort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import type { Member } from '../domain/types';

export interface MemberList {
  members: Member[];
  /** `true` si la lista no es la de verdad: falta H2 o su lectura falló. */
  degraded: boolean;
}

/** Lo mínimo honesto cuando no hay lista: la persona que está mirando. */
function soloYo(ctx: TenantContext): Member[] {
  return ctx.userEmail ? [{ email: ctx.userEmail, name: null }] : [];
}

export async function listMembers(ctx: TenantContext): Promise<MemberList> {
  const tenancy = tryPort('tenancy');
  if (!tenancy) return { members: soloYo(ctx), degraded: true };

  try {
    const filas = await tenancy.listMembers(ctx);
    const members = filas
      .map((m) => ({ email: m.email, name: m.name }))
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email, 'es'));
    return { members, degraded: false };
  } catch (err) {
    // Que falle el listado del equipo no puede tumbar la pantalla de tareas:
    // el 95% de lo que se hace aquí no necesita saber quiénes son los demás.
    console.warn('[work] no se pudo leer el equipo:', err instanceof Error ? err.message : String(err));
    return { members: soloYo(ctx), degraded: true };
  }
}
