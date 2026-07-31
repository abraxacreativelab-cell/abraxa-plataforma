/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Normalización de identidades
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El índice `UNIQUE (tenant_id, channel, identifier)` de 120 es toda la
 *  defensa contra contactos duplicados. Un índice único sólo vale lo que valga
 *  la función que produce su llave: si el webhook de WhatsApp escribe
 *  `5218146811675@s.whatsapp.net` y la UI escribe `+52 81 4681 1675`, el índice
 *  no ve un choque — ve dos filas distintas, y el emprendedor ve su
 *  conversación partida en dos tarjetas.
 *
 *  Por eso la normalización vive en UN archivo, no se hace en el llamador, y
 *  tiene sus propias pruebas. Es el eslabón más barato de romper y el más caro
 *  de descubrir roto.
 *
 *  ── La trampa mexicana ─────────────────────────────────────────────────────
 *
 *  México eliminó el `1` de los celulares en agosto de 2019, pero los JID de
 *  WhatsApp de números registrados antes lo siguen trayendo. La MISMA persona
 *  llega como `+5218146811675` (13 dígitos) por un canal y como
 *  `+528146811675` (12) por otro. Sin el ajuste de abajo son dos contactos, y
 *  es el duplicado más común del mercado en el que opera este producto.
 *
 *  ── Lo que a propósito NO se hace ──────────────────────────────────────────
 *
 *  Adivinar el país de un número de 10 dígitos. `8146811675` puede ser
 *  mexicano o estadounidense y elegir por el llamador sería inventar un dato.
 *  Se guarda tal cual, y `findDuplicates()` lo propone como posible duplicado
 *  por coincidencia de los últimos 10 dígitos — proponer es honesto, adivinar
 *  no.
 */
import { PlatformError } from '@abraxa/db';
import type { IdentityChannel } from './port';

/** Canales cuyo identificador es un número de teléfono. */
const CANALES_TELEFONO: ReadonlySet<string> = new Set(['whatsapp', 'sms']);

/** Canales cuyo identificador es un correo. */
const CANALES_CORREO: ReadonlySet<string> = new Set(['email']);

/** Sufijos de JID que agrega WhatsApp y que no son parte del número. */
const SUFIJOS_JID = ['@s.whatsapp.net', '@c.us', '@g.us', '@lid', '@broadcast'];

export interface IdentidadNormalizada {
  channel: IdentityChannel;
  /** La llave del índice único. */
  identifier: string;
  /** Lo que entró, sin tocar. Se guarda para poder depurar un choque. */
  raw: string;
}

/**
 * Deja un identificador en su forma canónica para el canal.
 *
 * Lanza `VALIDATION` si queda vacío: una identidad sin identificador no es una
 * identidad, y dejarla pasar crearía filas que nunca resuelven a nada.
 */
export function normalizarIdentidad(
  channel: IdentityChannel,
  entrada: string,
): IdentidadNormalizada {
  const raw = String(entrada ?? '');
  const limpio = raw.trim();

  if (!limpio) {
    throw new PlatformError(
      'VALIDATION',
      `Identidad de ${channel} vacía. Una identidad sin identificador no resuelve a nadie.`,
    );
  }

  let identifier: string;
  if (CANALES_TELEFONO.has(channel)) identifier = normalizarTelefono(limpio);
  else if (CANALES_CORREO.has(channel)) identifier = normalizarCorreo(limpio);
  else identifier = normalizarHandle(limpio);

  if (!identifier) {
    throw new PlatformError(
      'VALIDATION',
      `"${raw}" no deja nada utilizable como identidad de ${channel}.`,
    );
  }

  return { channel, identifier, raw };
}

/**
 * Teléfono → E.164 sin separadores.
 *
 *   `+52 81 4681 1675`              → `+528146811675`
 *   `5218146811675@s.whatsapp.net`  → `+528146811675`   (se cae el 1 mexicano)
 *   `00 52 81 4681 1675`            → `+528146811675`
 *   `8146811675`                    → `8146811675`      (sin país: no se inventa)
 */
export function normalizarTelefono(entrada: string): string {
  let s = entrada.trim().toLowerCase();

  // Fuera el sufijo de JID antes de tocar los dígitos: `@c.us` no aporta nada
  // y `@g.us` marca un GRUPO, que no es una persona (ver esGrupo()).
  for (const sufijo of SUFIJOS_JID) {
    if (s.endsWith(sufijo)) {
      s = s.slice(0, -sufijo.length);
      break;
    }
  }

  // Un JID puede traer `:12` (id de dispositivo) pegado al número.
  const dosPuntos = s.indexOf(':');
  if (dosPuntos > 0) s = s.slice(0, dosPuntos);

  const masInicial = s.startsWith('+');
  let digitos = s.replace(/\D/g, '');

  // `00` es el prefijo internacional de marcado en media Europa y América.
  if (!masInicial && digitos.startsWith('00')) digitos = digitos.slice(2);

  if (!digitos) return '';

  digitos = quitarUnoMexicano(digitos);

  // Con `+` explícito o con largo de número internacional, se canoniza con `+`.
  // Por debajo de 11 dígitos no hay forma de saber el país sin inventarlo.
  const internacional = masInicial || digitos.length >= 11;
  return internacional ? `+${digitos}` : digitos;
}

/**
 * `521` + 10 dígitos → `52` + 10 dígitos.
 *
 * Sólo para México y sólo en el largo exacto: `5219...` de 13 dígitos es un
 * celular mexicano con el 1 heredado. Cualquier otro largo se deja intacto —
 * hay países cuyo código nacional legítimamente empieza con 1 después del 52
 * y recortar a ciegas rompería sus números.
 */
function quitarUnoMexicano(digitos: string): string {
  if (digitos.length === 13 && digitos.startsWith('521')) return `52${digitos.slice(3)}`;
  return digitos;
}

/**
 * `true` si el identificador es un GRUPO de WhatsApp y no una persona.
 *
 * Un grupo no es un contacto: crear una tarjeta de CRM por cada grupo al que
 * alguien agrega el número del negocio llena la lista de basura en una semana.
 * H6 tiene que preguntar esto antes de resolver.
 */
export function esGrupo(entrada: string): boolean {
  const s = String(entrada ?? '')
    .trim()
    .toLowerCase();
  // `@g.us` y `@broadcast` son los sufijos que marca el propio WhatsApp. El
  // patrón `<creador>-<epoch>` es cómo se ven los JID de grupo viejos, que
  // llegan sin sufijo cuando el proveedor ya lo recortó.
  return s.endsWith('@g.us') || s.endsWith('@broadcast') || /^\d{6,}-\d{6,}$/.test(s);
}

/** Correo → minúsculas, sin `mailto:` ni espacios. */
export function normalizarCorreo(entrada: string): string {
  let s = entrada.trim().toLowerCase();
  if (s.startsWith('mailto:')) s = s.slice(7);
  // Un correo con nombre: `Ana <ana@abraxa.club>`.
  const abre = s.lastIndexOf('<');
  const cierra = s.lastIndexOf('>');
  if (abre !== -1 && cierra > abre) s = s.slice(abre + 1, cierra).trim();
  return s.replace(/\s+/g, '');
}

/**
 * Handle de red social → minúsculas, sin arroba ni URL.
 *
 *   `@Abraxa`                          → `abraxa`
 *   `https://instagram.com/abraxa/`    → `abraxa`
 *   `17841400000000000`                → `17841400000000000`  (PSID de Meta)
 */
export function normalizarHandle(entrada: string): string {
  let s = entrada.trim().toLowerCase();

  // URL de perfil: se queda el último segmento con contenido.
  if (s.includes('://') || s.startsWith('www.') || s.includes('.com/')) {
    const sinQuery = s.split(/[?#]/)[0] ?? s;
    const partes = sinQuery.split('/').filter(Boolean);
    const ultimo = partes[partes.length - 1];
    if (ultimo && !ultimo.includes('.')) s = ultimo;
  }

  if (s.startsWith('@')) s = s.slice(1);
  return s.replace(/\s+/g, '');
}

/**
 * Los últimos 10 dígitos de un teléfono. Es la llave con la que
 * `findDuplicates()` empareja `+528146811675` con `8146811675` sin afirmar que
 * son la misma persona.
 */
export function colaTelefonica(identifier: string): string | null {
  const digitos = identifier.replace(/\D/g, '');
  return digitos.length >= 10 ? digitos.slice(-10) : null;
}

/**
 * Etiqueta legible de una identidad, para la UI.
 * `+528146811675` → `+52 814 681 1675` es tentador y está mal: un formateo por
 * país que no conoce el país inventa espacios donde no van. Se deja el número
 * canónico, que siempre es correcto.
 */
export function etiquetaCanal(channel: IdentityChannel): string {
  const etiquetas: Record<string, string> = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    messenger: 'Messenger',
    email: 'Correo',
    sms: 'SMS',
    web: 'Web',
  };
  return etiquetas[channel] ?? channel;
}
