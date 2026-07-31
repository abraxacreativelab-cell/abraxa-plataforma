import type { PlatformErrorCode, PlatformErrorShape } from '../ports';

const STATUS: Record<PlatformErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  BUDGET_EXCEEDED: 402,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  CHANNEL_ERROR: 502,
  PORT_NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
};

const RETRYABLE: ReadonlySet<PlatformErrorCode> = new Set<PlatformErrorCode>([
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'CHANNEL_ERROR',
]);

/**
 * El error que cruza la frontera entre paquetes.
 *
 * Importa porque H6 llama a H3 sin conocer su código: necesita distinguir
 * "este tenant se pasó de presupuesto" (no reintentes, avísale) de "el
 * proveedor devolvió 503" (reintenta) sin acoplarse a nada de H3.
 *
 * `retryable` no es decorativo: el motor de H8 clasifica errores transitorios
 * contra permanentes para decidir si pausa la corrida o la mata.
 */
export class PlatformError extends Error implements PlatformErrorShape {
  readonly code: PlatformErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: PlatformErrorCode,
    message: string,
    options?: { details?: Record<string, unknown>; cause?: unknown; retryable?: boolean },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PlatformError';
    this.code = code;
    this.status = STATUS[code];
    this.retryable = options?.retryable ?? RETRYABLE.has(code);
    if (options?.details) this.details = options.details;
  }

  static is(e: unknown): e is PlatformError {
    return e instanceof PlatformError;
  }

  /** Cuerpo seguro para devolver por HTTP. Nunca filtra `details` internos. */
  toResponse(): { error: { code: PlatformErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

/** Atajos para los que más se usan. */
export const forbidden = (m = 'Sin acceso a este tenant'): PlatformError =>
  new PlatformError('FORBIDDEN', m);
export const notFound = (m = 'No existe'): PlatformError => new PlatformError('NOT_FOUND', m);
export const budgetExceeded = (m: string, details?: Record<string, unknown>): PlatformError =>
  new PlatformError('BUDGET_EXCEEDED', m, details ? { details } : undefined);
