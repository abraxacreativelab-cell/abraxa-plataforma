/**
 * Utilidades compartidas de acceso a datos y la forma de las filas.
 *
 * Todo lo que este paquete hace con datos de una empresa pasa por
 * `tenantDb(ctx)`. Las dos únicas excepciones son el ruteo inverso
 * (`src/routing.ts`) y el repaso periódico (`src/sweep.ts`), que por
 * definición no pueden estar acotados a un tenant —el primero SIRVE para
 * averiguar cuál es— y llevan su razón escrita en su propio archivo.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext, TenantDb } from '@abraxa/db';
import type { Integration, IntegrationStatus } from './port';
import { abrir, huella } from './crypto/secret-box';
import { deHex, tieneBytes } from './crypto/bytea';

/** Violación de índice único. */
export const CODIGO_DUPLICADO = '23505';

export interface ErrorPostgrest {
  code?: string;
  message: string;
}

/** La fila tal como vive en `app.tenant_integrations`. */
export interface FilaIntegracion {
  id: string;
  tenant_id: string;
  provider: string;
  label: string;
  external_account_id: string | null;
  config: Record<string, unknown> | null;
  secret_ct: unknown;
  secret_iv: unknown;
  secret_tag: unknown;
  key_version: number;
  status: IntegrationStatus;
  last_error: string | null;
  verified_at: string | null;
  expires_at: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

export const db = (ctx: TenantContext): TenantDb => tenantDb(ctx);

export const ahora = (): string => new Date().toISOString();

/**
 * El dato asociado que ata un sobre a su sitio.
 *
 * Va como AAD de AES-GCM, así que una fila copiada de una empresa a otra deja
 * de descifrar. Ver `src/crypto/secret-box.ts`.
 */
export const ataduraDe = (tenantId: string, provider: string): string => `${tenantId}:${provider}`;

/**
 * Un contexto de tenant armado a partir de una fila que YA se leyó.
 *
 * No es una puerta de atrás a la identidad: no viene de una cabecera ni de
 * nada que mande el navegador, sino del `tenant_id` de una fila que el proceso
 * acaba de leer con `adminDb()` en los dos únicos trabajos que no pueden estar
 * acotados a una empresa (el repaso periódico y la rotación de llave). Lo que
 * hace es que TODO lo que esos dos escriben vuelva a pasar por `tenantDb`.
 */
export function contextoDelSistema(tenantId: string): TenantContext {
  return { tenantId, tenantSlug: '', userEmail: null, role: null, areas: {} };
}

export const esDuplicado = (e: ErrorPostgrest | null | undefined): boolean =>
  e?.code === CODIGO_DUPLICADO;

/**
 * Traduce un error de PostgREST a `PlatformError`.
 *
 * El 23505 de esta tabla tiene un significado muy concreto y merece su propio
 * mensaje: esa cuenta externa ya está conectada en OTRA empresa. Es el índice
 * único parcial de la migración 140 haciendo su trabajo —una misma página de
 * Facebook no pertenece a dos negocios— y decirlo así ahorra la media hora de
 * mirar una restricción con nombre críptico.
 */
export function fallo(e: ErrorPostgrest, contexto: string): PlatformError {
  if (esDuplicado(e)) {
    return new PlatformError(
      'CONFLICT',
      `${contexto}: esa cuenta ya está conectada. Una misma cuenta del proveedor no puede ` +
        'pertenecer a dos empresas — si es tuya y la conectaste antes en otra, desconéctala ahí ' +
        'primero.',
      { details: { code: e.code } },
    );
  }
  if (e.code === '23503') {
    return new PlatformError('VALIDATION', `${contexto}: referencia inexistente`, {
      details: { code: e.code },
    });
  }
  return new PlatformError('INTERNAL', `${contexto}: ${e.message}`, {
    details: { code: e.code ?? null },
  });
}

export function lista<T>(
  r: { data: T[] | null; error: ErrorPostgrest | null },
  contexto: string,
): T[] {
  if (r.error) throw fallo(r.error, contexto);
  return r.data ?? [];
}

export function una<T>(
  r: { data: T | null; error: ErrorPostgrest | null },
  contexto: string,
): T | null {
  if (r.error) throw fallo(r.error, contexto);
  return r.data;
}

/**
 * El secreto en claro de una fila, o `null` si no tiene.
 *
 * Sólo se llama desde dentro del proceso y el resultado no se serializa nunca.
 */
export function secretoDe(fila: FilaIntegracion): string | null {
  if (!tieneBytes(fila.secret_ct)) return null;
  return abrir(
    {
      ct: deHex(fila.secret_ct),
      iv: deHex(fila.secret_iv),
      tag: deHex(fila.secret_tag),
      version: Number(fila.key_version) || 1,
    },
    ataduraDe(fila.tenant_id, fila.provider),
  );
}

/**
 * Fila → lo que sale por HTTP. **Aquí se decide qué ve el mundo.**
 *
 * La huella se calcula descifrando el secreto y resumiéndolo, no derivándola
 * del ciphertext: dos cifrados del MISMO secreto dan bytes distintos (nonce
 * por sobre), así que una huella derivada del ciphertext cambiaría sola y no
 * contestaría la única pregunta que tiene que contestar — "¿la que está puesta
 * es la que acabo de pegar?".
 *
 * Si el descifrado falla —llave retirada, fila alterada— la huella es `null` y
 * la fila sigue saliendo con su estado. Perder la etiqueta no es motivo para
 * esconderle al emprendedor que tiene una integración rota.
 */
export function aIntegration(fila: FilaIntegracion): Integration {
  let fingerprint: string | null = null;
  try {
    const secreto = secretoDe(fila);
    fingerprint = secreto ? huella(secreto) : null;
  } catch {
    fingerprint = null;
  }

  return {
    id: fila.id,
    provider: fila.provider,
    label: fila.label,
    externalAccountId: fila.external_account_id ?? null,
    config: (fila.config ?? {}) as Record<string, unknown>,
    status: fila.status,
    fingerprint,
    lastError: fila.last_error ?? null,
    verifiedAt: fila.verified_at ?? null,
    expiresAt: fila.expires_at ?? null,
    keyVersion: Number(fila.key_version) || 1,
    connectedBy: fila.connected_by ?? null,
    createdAt: fila.created_at,
    updatedAt: fila.updated_at ?? fila.created_at,
  };
}

/**
 * Las columnas que se piden. Se escriben a mano para que un `select('*')` no
 * empiece a arrastrar columnas nuevas sin que nadie lo decida.
 *
 * Va en UNA sola literal y con `as const` a propósito, aunque no quepa en la
 * línea: postgrest-js deduce el tipo de la respuesta PARSEANDO esta cadena en
 * tiempo de tipos, y una concatenación (`'a,b,' + 'c'`) le llega como `string`
 * —no como literal—, así que devuelve `GenericStringError` y el typecheck se
 * cae en cada llamada. Partirla en dos por estética cuesta ocho errores.
 */
export const COLUMNAS =
  'id,tenant_id,provider,label,external_account_id,config,secret_ct,secret_iv,secret_tag,key_version,status,last_error,verified_at,expires_at,connected_by,created_at,updated_at' as const;
