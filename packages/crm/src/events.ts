/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los disparadores que este paquete le debe a H8
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  De los ocho `TriggerType` de `packages/db/ports.ts`, CUATRO nacen aquí:
 *
 *      contact_created   ← create() y resolveByIdentity() cuando crea
 *      stage_changed     ← moveStage(), sólo si de verdad cambió de etapa
 *      tag_added         ← addTag(), sólo si la etiqueta no estaba
 *      form_submitted    ← lo emite quien reciba el formulario (H10), con el
 *                          contactId que le devuelve resolveByIdentity()
 *
 *  Sin este archivo, "cuando entre un lead, mándale un WhatsApp" —el ejemplo
 *  literal con el que abre el handoff de H8— no tiene quién lo dispare.
 *
 *  ── Best effort, siempre ───────────────────────────────────────────────────
 *
 *  Se emite con `tryPort('flows')`, no con `usePort`. Si H8 no ha aterrizado,
 *  o si su motor está caído, el CRM sigue funcionando: un contacto que se crea
 *  vale más que la automatización que no se disparó. Y si emitir lanzara, un
 *  motor de flujos con problemas volvería imposible dar de alta un contacto —
 *  que es exactamente el tipo de acoplamiento que tumba un producto entero por
 *  un subsistema secundario.
 *
 *  El fallo se anota en la línea de tiempo del contacto, así que no se pierde:
 *  queda a la vista de quien abra la ficha.
 */
import { tryPort } from '@abraxa/db';
import type { TenantContext, TriggerType } from '@abraxa/db';

/** Los cuatro que emite el CRM. */
export type CrmTrigger = Extract<
  TriggerType,
  'contact_created' | 'stage_changed' | 'tag_added' | 'form_submitted'
>;

export interface PayloadDisparador {
  contactId: string;
  [k: string]: unknown;
}

/**
 * Publica un evento de dominio en el motor de H8. Nunca lanza.
 *
 * Devuelve `true` si de verdad salió, para que el llamador pueda anotarlo en
 * la línea de tiempo — "se movió a Contactado pero el motor de flujos estaba
 * caído" es información que el emprendedor necesita cuando su automatización
 * no corrió.
 */
export async function emitir(
  ctx: TenantContext,
  type: CrmTrigger,
  payload: PayloadDisparador,
): Promise<boolean> {
  const flows = tryPort('flows');
  if (!flows) return false;

  try {
    await flows.emit(ctx, { type, payload });
    return true;
  } catch (e) {
    console.warn(
      `[crm] el motor de flujos rechazó ${type} del contacto ${payload.contactId}:`,
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}
