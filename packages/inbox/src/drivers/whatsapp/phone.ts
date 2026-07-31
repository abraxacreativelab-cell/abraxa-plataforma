/**
 * Teléfonos y JIDs — el único archivo del paquete que sabe qué es un JID.
 *
 * Ése es el punto. En GARDEN `phoneToJid()` se llamaba desde el inbox
 * (src/crm/inbox/service.ts:201) y desde el motor de workflows
 * (src/crm/workflows/engine.ts:472), y con eso el supuesto "toda dirección es
 * WhatsApp" quedó cosido a dos subsistemas que no tienen nada que ver con
 * WhatsApp. Aquí vive dentro del driver y nadie más lo importa.
 */

/**
 * Teléfono a E.164 canónico.
 *
 * CRÍTICO: colapsa el `1` de móvil de México. WhatsApp manda `52 1 XXXXXXXXXX`
 * y los formularios mandan 10 dígitos; si no convergen, el MISMO cliente abre
 * dos hilos y el agente le contesta como si no lo conociera.
 *
 *   5215512345678  → +525512345678   (WhatsApp MX, se quita el 1 de móvil)
 *   525512345678   → +525512345678
 *   5512345678     → +525512345678   (10 dígitos → se asume MX)
 *   +1 415 555 0123 → +14155550123   (internacional se respeta)
 */
export function normalizarTelefono(raw: string): string {
  let digitos = String(raw ?? '').replace(/\D/g, '');
  if (!digitos) return '';
  // MX móvil con el 1 tras el país: 52 + 1 + 10 dígitos = 13
  if (digitos.length === 13 && digitos.startsWith('521')) digitos = `52${digitos.slice(3)}`;
  // 10 dígitos sueltos → MX
  else if (digitos.length === 10) digitos = `52${digitos}`;
  return `+${digitos}`;
}

/** El JID que entiende WhatsApp, desde un teléfono en cualquier forma. */
export function telefonoAJid(telefono: string): string {
  return `${normalizarTelefono(telefono).replace(/^\+/, '')}@s.whatsapp.net`;
}

/** El teléfono canónico desde un `remoteJid`. */
export function jidATelefono(jid: string): string {
  return normalizarTelefono(String(jid ?? '').split('@')[0] ?? '');
}

/** `true` para grupos y estados: no son conversaciones uno a uno. */
export function esJidIgnorable(jid: string): boolean {
  const j = String(jid ?? '');
  return j.length === 0 || j.endsWith('@g.us') || j === 'status@broadcast';
}
