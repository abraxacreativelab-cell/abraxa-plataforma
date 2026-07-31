/**
 * Traducción de errores de Postgres al error compartido de la plataforma.
 *
 * La lógica de tenancy vive en funciones de plpgsql porque ahí la atomicidad
 * se hereda en vez de implementarse (ver migración 011). El precio es que sus
 * fallos llegan como un `PostgrestError` con un SQLSTATE, y si eso sube tal
 * cual, H10 recibe un 500 genérico donde debería recibir un 409 accionable —
 * y reintenta un webhook de Stripe que nunca va a funcionar.
 *
 * Aquí se paga ese precio una vez.
 */
import { PlatformError } from '@abraxa/db';
import type { PlatformErrorCode } from '@abraxa/db/ports';
import { ZodError, type ZodType, type output } from 'zod';

/** Los SQLSTATE propios de H2. Definidos en las migraciones 011 y 012. */
export const TENANCY_SQLSTATE = {
  SLUG_TOMADO: 'ABX01',
  ENTRADA_INVALIDA: 'ABX02',
  INVITACION_NO_EXISTE: 'ABX03',
  SIN_ASIENTOS: 'ABX04',
  ES_EL_DUENO: 'ABX05',
  INVITACION_INVALIDA: 'ABX06',
} as const;

const POR_SQLSTATE: Record<string, PlatformErrorCode> = {
  // Propios de H2.
  ABX01: 'CONFLICT',
  ABX02: 'VALIDATION',
  ABX03: 'NOT_FOUND',
  ABX04: 'CONFLICT',
  ABX05: 'CONFLICT',
  ABX06: 'CONFLICT',

  // De Postgres. Que una restricción se dispare NO es un error interno: es la
  // base rechazando una entrada inválida, y al cliente le sirve saberlo.
  '23505': 'CONFLICT', // unique_violation
  '23503': 'VALIDATION', // foreign_key_violation
  '23514': 'VALIDATION', // check_violation
  '23502': 'VALIDATION', // not_null_violation
  '22P02': 'VALIDATION', // invalid_text_representation (uuid mal formado)
  '42501': 'FORBIDDEN', // insufficient_privilege
};

interface ErrorDePostgrest {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

const esErrorDePostgrest = (e: unknown): e is ErrorDePostgrest =>
  typeof e === 'object' && e !== null && ('code' in e || 'message' in e);

/**
 * Convierte el error de una llamada a Postgres en un `PlatformError`.
 *
 * `contexto` es lo que se muestra cuando el error no se reconoce: sirve para
 * que un fallo raro diga al menos qué se estaba intentando hacer.
 */
export function mapPgError(error: unknown, contexto: string): PlatformError {
  if (PlatformError.is(error)) return error;

  if (!esErrorDePostgrest(error)) {
    return new PlatformError('INTERNAL', contexto, { cause: error });
  }

  const code = String(error.code ?? '');
  const mensaje = String(error.message ?? '').trim() || contexto;

  /*
   * La función no existe en la base.
   *
   * Pasa exactamente una vez por ambiente: cuando el código ya está desplegado
   * y las migraciones 011/012 todavía no se aplicaron. Sin este mensaje el
   * síntoma es un 500 opaco en el alta de clientes y media tarde de búsqueda.
   */
  if (code === 'PGRST202' || code === '42883') {
    return new PlatformError(
      'INTERNAL',
      `${contexto}: la función de base de datos no existe. ¿Se aplicaron las migraciones 011 y 012? ` +
        '(`npm run migrate`)',
      { details: { pgCode: code }, cause: error },
    );
  }

  const platformCode = POR_SQLSTATE[code];
  if (platformCode) {
    return new PlatformError(platformCode, mensaje, { details: { pgCode: code } });
  }

  return new PlatformError('INTERNAL', `${contexto}: ${mensaje}`, {
    details: { pgCode: code },
    cause: error,
  });
}

/**
 * Valida con zod y convierte el fallo en un 422 legible.
 *
 * Sin esto, un `slug` con mayúsculas viaja hasta Postgres y vuelve como el
 * texto de una restricción CHECK — cierto, pero inservible para quien está
 * llenando un formulario.
 */
export function validar<S extends ZodType>(
  schema: S,
  entrada: unknown,
  contexto: string,
): output<S> {
  const r = schema.safeParse(entrada);
  if (r.success) return r.data as output<S>;

  const detalle = r.error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join(' · ');

  throw new PlatformError('VALIDATION', `${contexto}: ${detalle}`, {
    details: { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
  });
}

/** `true` si el error viene de zod (útil en los `catch` de las rutas). */
export const esErrorDeValidacion = (e: unknown): e is ZodError => e instanceof ZodError;

/** Atajos con el vocabulario de H2. */
export const sinAccesoAlTenant = (): PlatformError =>
  new PlatformError(
    'FORBIDDEN',
    'No tienes acceso a esta empresa.',
  );

export const sinContexto = (): PlatformError =>
  new PlatformError(
    'UNAUTHENTICATED',
    'Sin contexto de empresa. La petición tiene que pasar por el proxy verificado.',
  );

export { PlatformError };
