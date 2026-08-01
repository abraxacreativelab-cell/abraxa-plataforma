/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La dirección de alguien en Instagram o Messenger.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  En WhatsApp la dirección es un teléfono y significa algo fuera del canal: el
 *  mismo `+528146811675` sirve para llamar, para facturar y para reconocer a la
 *  persona en otro sistema.
 *
 *  Aquí no. La dirección es un **id opaco y con alcance**:
 *
 *    · PSID  (Messenger) — `page-scoped id`. La MISMA persona tiene un PSID
 *      distinto en cada página. No es un identificador de la persona: es un
 *      identificador de la relación entre esa persona y esa página.
 *    · IGSID (Instagram) — lo mismo, con alcance de cuenta de Instagram.
 *
 *  De ahí sale la regla del handoff (§5) que este archivo hace cumplir por
 *  omisión: **no se fusionan contactos solos.** El mismo humano puede ser un
 *  teléfono en WhatsApp y un id opaco en Instagram, y nada en el id permite
 *  saberlo. Proponer una fusión es útil; ejecutarla sin que un humano la mire
 *  revuelve dos clientes, y eso no se deshace fácil.
 *
 *  Este driver, por tanto, sólo produce la dirección; **no toca
 *  `contact_identities` ni crea contactos**. Esa resolución tiene dueño y ya
 *  existe: `useContacts().resolveByIdentity()` de H15
 *  (`packages/crm/src/port.ts:279`), que la llama el núcleo del inbox. Escribir
 *  aquí una segunda ruta de alta de contactos sería la quinta copia de una
 *  pieza que ya está resuelta.
 *
 *  ── Por qué la normalización es ÉSTA y no otra ─────────────────────────────
 *
 *  Tiene que coincidir con `normalizarHandle()` de H15
 *  (`packages/crm/src/identity.ts:194-207`), porque el CRM normaliza otra vez
 *  por su cuenta antes de escribir la identidad. Si las dos difieren aunque sea
 *  en las mayúsculas, el índice único `(tenant_id, channel, identifier)` deja de
 *  emparejar y el mismo cliente acaba con dos fichas.
 *
 *  Y tiene que ser **idempotente** —`f(f(x)) === f(x)`, que es lo que exige
 *  `ExtrasDriver.normalizeAddress`— porque se aplica tanto a lo que llega del
 *  webhook como a lo que escribe un humano en la bandeja. Si las dos rutas no
 *  convergen, se abren dos hilos para la misma persona.
 */

/** Los prefijos de URL de perfil que la gente pega en la bandeja. */
const HOSTS = ['instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com', 'm.me', 'ig.me'];

/**
 * Forma canónica de una dirección de Instagram o Messenger.
 *
 *   `17841400000000000`                    → `17841400000000000`   (IGSID, tal cual)
 *   `@Abraxa`                              → `abraxa`
 *   `https://instagram.com/Abraxa/`        → `abraxa`
 *   `  6072...  `                          → `6072...`
 *
 * Los ids se dejan intactos salvo por el recorte y las minúsculas: son opacos y
 * **cualquier "arreglo" sobre ellos los rompe**. Es la tentación que hay que
 * resistir aquí — un PSID de 17 dígitos parece un número y no lo es. Tratarlo
 * como número lo redondea (`Number('17841400000000000')` ya pierde precisión) y
 * el mensaje se va al vacío.
 */
export function normalizarDireccionMeta(raw: string): string {
  let s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return '';

  // URL de perfil: se queda el último segmento con contenido. Mismo criterio
  // que `normalizarHandle` de H15, para que las dos converjan.
  if (s.includes('://') || HOSTS.some((h) => s.startsWith(h) || s.startsWith(`www.${h}`))) {
    const sinQuery = s.split(/[?#]/)[0] ?? s;
    const partes = sinQuery.split('/').filter(Boolean);
    const ultimo = partes[partes.length - 1];
    if (ultimo && !ultimo.includes('.')) s = ultimo;
  }

  if (s.startsWith('@')) s = s.slice(1);
  return s.replace(/\s+/g, '');
}

/**
 * Cómo se le enseña la dirección al emprendedor.
 *
 * Un id opaco no se maquilla. Se pensó en recortarlo (`…4491`) y está mal: el
 * id es lo ÚNICO con lo que se puede pedir soporte a Meta o depurar por qué un
 * mensaje no salió, y un id a medias no sirve para ninguna de las dos.
 *
 * Lo que sí se hace es marcar cuándo es un id y no un handle, para que quien lo
 * ve en la bandeja no crea que el cliente se llama «17841400000000000».
 */
export function mostrarDireccionMeta(address: string): string {
  const a = String(address ?? '').trim();
  if (!a) return '';
  return esIdOpaco(a) ? `id:${a}` : `@${a}`;
}

/** `true` si esto es un id con alcance de Meta y no un nombre de usuario. */
export function esIdOpaco(address: string): boolean {
  return /^\d{6,}$/.test(String(address ?? '').trim());
}
