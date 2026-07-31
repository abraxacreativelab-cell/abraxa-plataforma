/**
 * Utilidades compartidas de acceso a datos.
 *
 * Todo lo de este paquete pasa por `tenantDb(ctx)` de H1 y por aquí. No hay
 * una sola llamada a `adminDb()` ni a `serviceClient()`: las ocho tablas de
 * H15 tienen `tenant_id` y ninguna es global, así que nunca hace falta salirse
 * del carril aislado — y por eso ESLint no tiene nada que reclamarle a este
 * paquete.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext, TenantDb } from '@abraxa/db';
import { CODIGO_DUPLICADO, type ErrorPostgrest } from './types';

export const db = (ctx: TenantContext): TenantDb => tenantDb(ctx);

export const ahora = (): string => new Date().toISOString();

/** `true` si el error es una violación de índice único. */
export const esDuplicado = (e: ErrorPostgrest | null | undefined): boolean =>
  e?.code === CODIGO_DUPLICADO;

/**
 * Traduce un error de PostgREST a `PlatformError`.
 *
 * Existe para que un fallo de base no salga como `INTERNAL` sin contexto: el
 * motor de H8 clasifica errores por `retryable` para decidir si pausa la
 * corrida o la mata, y un 500 genérico lo obliga a adivinar.
 */
export function fallo(e: ErrorPostgrest, contexto: string): PlatformError {
  if (e.code === CODIGO_DUPLICADO) {
    return new PlatformError('CONFLICT', `${contexto}: ya existe (${e.message})`, {
      details: { code: e.code },
    });
  }
  // 23503 = FK violada: se apunta a algo que no está. Es dato malo, no red.
  if (e.code === '23503') {
    return new PlatformError('VALIDATION', `${contexto}: referencia inexistente (${e.message})`, {
      details: { code: e.code },
    });
  }
  return new PlatformError('INTERNAL', `${contexto}: ${e.message}`, {
    details: { code: e.code ?? null },
  });
}

/**
 * Filas de un resultado de PostgREST, o lanza con contexto.
 *
 * Una lista VACÍA no es un error y no se trata como tal: un negocio recién dado
 * de alta no tiene contactos, y devolver un fallo por eso haría que la pantalla
 * pintara un rojo de disculpa donde debe ir una invitación a empezar.
 */
export function lista<T>(
  r: { data: T[] | null; error: ErrorPostgrest | null },
  contexto: string,
): T[] {
  if (r.error) throw fallo(r.error, contexto);
  return r.data ?? [];
}

/**
 * Slug estable a partir de un nombre.
 *
 * Lo usan los embudos y las etapas: el nombre lo renombra el emprendedor
 * cuando quiere, pero el slug es lo que escribe una automatización de H8 en su
 * configuración. Si el slug cambiara al renombrar, renombrar una etapa
 * rompería en silencio todos los flujos que la mencionan.
 */
export function aSlug(texto: string): string {
  return sinAcentos(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Escapa lo que PostgREST trata como separador dentro de un `or(...)`. */
export function escaparFiltro(texto: string): string {
  return texto.replace(/[,()"\\]/g, ' ').trim();
}

/** Convierte `numeric` de Postgres (que llega como string) a número. */
export function aNumero(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Quita los diacríticos combinantes. "José" y "Jose" tienen que producir la
 * misma llave, tanto para un slug como para emparejar duplicados por nombre.
 */
export function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
