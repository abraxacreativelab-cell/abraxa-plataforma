/**
 * Formateo para la pantalla. Nada de esto toca datos ni red.
 */
import type { IdentityChannel, Lifecycle } from './tipos';

const ETIQUETA_CANAL: Record<IdentityChannel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  email: 'Correo',
  sms: 'SMS',
  web: 'Web',
};

const ICONO_CANAL: Record<IdentityChannel, string> = {
  whatsapp: 'messages',
  instagram: 'megaphone',
  messenger: 'messages',
  email: 'file',
  sms: 'messages',
  web: 'compass',
};

export const etiquetaCanal = (c: IdentityChannel): string => ETIQUETA_CANAL[c] ?? c;
export const iconoCanal = (c: IdentityChannel): string => ICONO_CANAL[c] ?? 'contact';

export const ETIQUETA_CICLO: Record<Lifecycle, string> = {
  lead: 'Lead',
  prospect: 'Prospecto',
  customer: 'Cliente',
  churned: 'Se fue',
  unknown: 'Sin clasificar',
};

/** Variante de `Badge` por ciclo de vida. Los semánticos no siguen al acento. */
export function varianteCiclo(c: Lifecycle): 'default' | 'success' | 'warning' | 'outline' {
  if (c === 'customer') return 'success';
  if (c === 'churned') return 'warning';
  if (c === 'lead') return 'default';
  return 'outline';
}

/**
 * "hace 3 h", "ayer", "12 jul".
 *
 * Se calcula contra `ahora` recibido y no contra `Date.now()` dentro: así el
 * servidor y el cliente pintan lo mismo y React no se queja de hidratación
 * desajustada — el error que produce un `Date.now()` en un componente de
 * servidor y otro en el navegador milisegundos después.
 */
export function haceCuanto(iso: string | null, ahora: number): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';

  const segundos = Math.max(0, Math.floor((ahora - t) / 1000));
  if (segundos < 60) return 'ahora';
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;

  return new Date(t).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/** Moneda sin decimales: en un tablero de embudo los centavos son ruido. */
export function dinero(cantidad: number, moneda = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(cantidad);
}

/** Iniciales para el avatar. Nunca más de dos letras. */
export function iniciales(nombre: string | null): string {
  const limpio = (nombre ?? '').trim();
  if (!limpio) return '··';
  const partes = limpio.split(/\s+/).filter(Boolean);
  const primera = partes[0]?.[0] ?? '';
  const segunda = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';
  return (primera + segunda).toUpperCase() || '··';
}

/** Icono de la línea de tiempo por tipo de evento. */
export function iconoEvento(tipo: string): string {
  const mapa: Record<string, string> = {
    contact_created: 'plus',
    identity_added: 'contact',
    stage_changed: 'kanban',
    tag_added: 'check',
    tag_removed: 'x',
    owner_assigned: 'users',
    lifecycle_changed: 'target',
    note: 'file',
    message_in: 'inbox',
    message_out: 'arrow-right',
    merged: 'workflow',
    field_changed: 'settings',
  };
  return mapa[tipo] ?? 'help';
}
