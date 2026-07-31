/**
 * Las FILAS, tal como salen de Postgres.
 *
 * Separadas de `port.ts` a propósito: aquél es el contrato que ven H6 y H8 y
 * está en camelCase; éste es la forma cruda con snake_case que nadie fuera de
 * este paquete debería tener que conocer. Traducir en la frontera —y no dejar
 * que el nombre de una columna se filtre a cuatro carriles— es lo que permite
 * renombrar una columna sin abrir un PR en el paquete de nadie más.
 */

export interface FilaContacto {
  id: string;
  tenant_id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  owner_email: string | null;
  lifecycle: string;
  source: string | null;
  locale: string | null;
  custom: Record<string, unknown> | null;
  merged_into: string | null;
  merged_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FilaIdentidad {
  id: string;
  tenant_id: string;
  contact_id: string;
  channel: string;
  identifier: string;
  raw: string | null;
  display: string | null;
  verified: boolean;
  is_primary: boolean;
  created_at: string;
}

export interface FilaEtiqueta {
  tenant_id: string;
  contact_id: string;
  tag: string;
  added_by: string | null;
  created_at: string;
}

export interface FilaEmbudo {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  is_default: boolean;
  position: number;
  created_at: string;
}

export interface FilaEtapa {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  slug: string;
  name: string;
  position: number;
  probability: number;
  is_won: boolean;
  is_lost: boolean;
  created_at: string;
}

export interface FilaPosicion {
  tenant_id: string;
  contact_id: string;
  pipeline_id: string;
  stage_id: string;
  amount: string | number | null;
  currency: string;
  position: number;
  entered_at: string;
  updated_at: string;
}

export interface FilaEvento {
  id: string;
  tenant_id: string;
  contact_id: string;
  type: string;
  summary: string;
  payload: Record<string, unknown> | null;
  actor: string | null;
  source: string;
  external_id: string | null;
  occurred_at: string;
  created_at: string;
}

/**
 * Código de Postgres para "violación de unicidad".
 *
 * Es el corazón de `resolveByIdentity`: dos webhooks simultáneos del mismo
 * número entran los dos, uno gana el índice y el otro recibe esto. Tratarlo
 * como éxito —releer al ganador— es lo que hace la operación segura ante
 * concurrencia. Comprobar antes con un SELECT no lo es: entre el SELECT y el
 * INSERT cabe el otro webhook.
 */
export const CODIGO_DUPLICADO = '23505';

/** Error de PostgREST tal como lo devuelve supabase-js. */
export interface ErrorPostgrest {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}
