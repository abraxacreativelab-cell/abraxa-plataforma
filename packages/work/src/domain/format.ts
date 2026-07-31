/**
 * Formateo en español, para la pantalla.
 *
 * Todo trabaja sobre `YYYY-MM-DD` en hora LOCAL. Construir un `Date` a partir
 * de `'2026-08-03'` con `new Date(cadena)` lo interpreta como medianoche UTC y
 * en México lo pinta como el 2 de agosto. Por eso las fechas se parten a mano.
 */

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function hoyLocal(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/** `2026-08-03` → `3 ago`. Con el año sólo cuando no es el actual: repetirlo en
 *  cada tarjeta es ruido, y omitirlo cuando cambia es un error. */
export function fechaCorta(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return iso;
  const mes = MESES_CORTOS[m - 1] ?? '';
  return a === now.getFullYear() ? `${d} ${mes}` : `${d} ${mes} ${a}`;
}

/** Cuántos días faltan (negativo si ya pasó). */
export function diasHasta(iso: string, now = new Date()): number {
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return 0;
  const objetivo = new Date(a, m - 1, d);
  const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((objetivo.getTime() - hoy.getTime()) / 86_400_000);
}

/**
 * La frase que va en la tarjeta: "vence hoy", "mañana", "hace 3 días".
 *
 * Cerca se dice en palabras y lejos con la fecha: "en 47 días" no le dice nada
 * a nadie, "18 sep" sí.
 */
export function vencimiento(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const dias = diasHasta(iso, now);
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  if (dias === -1) return 'ayer';
  if (dias < 0) return dias >= -7 ? `hace ${-dias} días` : `venció el ${fechaCorta(iso, now)}`;
  if (dias <= 7) return `en ${dias} días`;
  return fechaCorta(iso, now);
}

/** Un instante ISO → "hace 5 min" / "3 ago". Para el historial y los comentarios. */
export function desde(iso: string, now = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const seg = Math.round((now.getTime() - t) / 1000);
  if (seg < 60) return 'hace un momento';
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86_400) return `hace ${Math.floor(seg / 3600)} h`;
  if (seg < 604_800) return `hace ${Math.floor(seg / 86_400)} d`;
  return fechaCorta(new Date(t).toISOString().slice(0, 10), now);
}

/** El nombre corto de una persona: su nombre, o la parte del correo antes de la
 *  arroba. Un `@` en una tarjeta ocupa espacio y no dice nada. */
export function nombreCorto(email: string | null | undefined, nombre?: string | null): string {
  if (nombre?.trim()) return nombre.trim();
  if (!email) return 'Sin responsable';
  return email.split('@')[0] ?? email;
}

/** Iniciales para el avatar. */
export function iniciales(email: string | null | undefined, nombre?: string | null): string {
  const base = nombreCorto(email, nombre);
  const partes = base.split(/[\s._-]+/).filter(Boolean);
  const a = partes[0]?.[0] ?? '?';
  const b = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';
  return (a + b).toUpperCase();
}

export function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}
