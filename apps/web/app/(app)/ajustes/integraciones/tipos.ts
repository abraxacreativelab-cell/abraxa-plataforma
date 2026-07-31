/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los tipos de las integraciones, del lado del navegador
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Son un espejo de `packages/integrations/src/port.ts` y NO se importan de
 *  allá, por la misma razón concreta que documenta H15 en su pantalla:
 *  `apps/web/next.config.mjs` lista los paquetes que Next transpila y
 *  `apps/web/package.json` sus dependencias. Los dos son de H1 y el gate falla
 *  cualquier PR que los toque, así que importar `@abraxa/integrations` desde
 *  aquí haría que Next intentara compilar TypeScript crudo desde
 *  `node_modules` y el build reventaría.
 *
 *  Duplicar tipos es deuda y está declarada: en cuanto H1 agregue
 *  `'@abraxa/integrations'` a `transpilePackages` y a las dependencias de la
 *  app, este archivo se borra. Está en la lista de §10 del handoff.
 *
 *  Fíjate en lo que este espejo NO tiene, y no por olvido: un campo con el
 *  secreto. No existe en el port y no existe aquí. Lo que hay es `fingerprint`.
 */

export type IntegrationStatus = 'pending' | 'connected' | 'error' | 'revoked';

export interface Integration {
  id: string;
  provider: string;
  label: string;
  externalAccountId: string | null;
  config: Record<string, unknown>;
  status: IntegrationStatus;
  /** `••••4821 · a1b2c3d4`. Distingue una credencial de otra sin usarla. */
  fingerprint: string | null;
  lastError: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  connectedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampoConfig {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface ProviderInfo {
  name: string;
  label: string;
  secretLabel: string;
  configFields: CampoConfig[];
  /** Si es `false`, ninguna variable de entorno lo enciende. */
  fallbackAllowed: boolean;
  fallbackReason: string;
  /** `true` si el respaldo está permitido Y encendido en este despliegue. */
  fallbackActive: boolean;
}

export interface IntegrationEvent {
  id: string;
  integrationId: string | null;
  provider: string;
  type: string;
  detail: Record<string, unknown>;
  actor: string | null;
  createdAt: string;
}
