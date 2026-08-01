import type { VaultKind, VaultRow } from './types';
import { ETIQUETA_KIND } from './copy';

/**
 * Cómo se ve un valor canónico cuando sale de la bóveda.
 *
 * Portado de GARDEN `src/vault/resolver.ts:125-153` con UN cambio deliberado:
 * allá el formato de dinero usaba `maximumFractionDigits: 0`, así que un
 * precio de 1,500.50 se renderizaba como $1,501 en el contrato del cliente.
 * Redondear en silencio un número que va a un contrato no es un detalle de
 * presentación. Aquí los centavos se muestran cuando existen y se callan
 * cuando no: $1,500 y $1,500.50.
 */

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, conCentavos: boolean): Intl.NumberFormat {
  const code = (currency || 'MXN').toUpperCase();
  const clave = `${code}|${conCentavos}`;
  let f = moneyFormatters.get(clave);
  if (!f) {
    f = new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: code,
      // Los centavos son todo o nada. Con `min: 0, max: 2` a secas, 1500.50 se
      // renderiza "$1,500.5" —con UN decimal— porque Intl no rellena el cero
      // final. Un precio con un decimal suelto en una cotización se lee como
      // un error de captura, y le cuesta credibilidad a quien la manda.
      minimumFractionDigits: conCentavos ? 2 : 0,
      maximumFractionDigits: conCentavos ? 2 : 0,
    });
    moneyFormatters.set(clave, f);
  }
  return f;
}

/** Dinero en el formato del país: `$1,500` · `$1,500.50` · `US$99`. */
export function formatMoney(value: number | null | undefined, currency = 'MXN'): string {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const n = Number(value);
  return moneyFormatter(currency, !Number.isInteger(n)).format(n);
}

/** Dos decimales siempre. Para estados de cuenta y sumas que deben cuadrar. */
export function formatMoney2(value: number | null | undefined, currency = 'MXN'): string {
  if (value == null || !Number.isFinite(Number(value))) return '';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: (currency || 'MXN').toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/** Una fila → el texto que se interpola en plantillas y prompts. */
export function formatVault(row: VaultRow): string {
  switch (row.kind) {
    case 'money':
      return row.value == null ? (row.value_text ?? '') : formatMoney(row.value, row.currency);

    case 'percent':
      return row.value == null ? (row.value_text ?? '') : `${Number(row.value)}%`;

    case 'number': {
      if (row.value == null) return row.value_text ?? '';
      const n = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 4 }).format(
        Number(row.value),
      );
      return row.unit ? `${n} ${row.unit}` : n;
    }

    case 'bool':
      // La UI guarda el booleano en value_json; GARDEN lo leía de value_text.
      // Se aceptan los dos para no perder valores viejos de una ingesta.
      if (typeof row.value_json === 'boolean') return row.value_json ? 'sí' : 'no';
      if (row.value_text) return row.value_text;
      return row.value == null ? '' : row.value ? 'sí' : 'no';

    case 'list':
      if (Array.isArray(row.value_json)) return (row.value_json as unknown[]).join(', ');
      return row.value_text ?? '';

    case 'date':
    case 'text':
      return row.value_text ?? (row.value != null ? String(row.value) : '');

    default: {
      // El `kind` viene de una columna con CHECK, pero si algún día se agrega
      // uno nuevo, esto obliga a pasar por aquí en vez de fallar silencioso.
      const _exhaustivo: never = row.kind;
      return String(_exhaustivo ?? '');
    }
  }
}

/**
 * Etiqueta legible de un tipo. La usan la UI y los mensajes de error.
 * La tabla vive en `copy.ts`, con el resto del vocabulario visible.
 */
export const KIND_LABEL: Record<VaultKind, string> = ETIQUETA_KIND;
