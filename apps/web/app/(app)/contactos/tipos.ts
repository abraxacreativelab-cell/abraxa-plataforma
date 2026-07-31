/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los tipos del CRM, del lado del navegador
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Son un espejo de `packages/crm/src/port.ts` y NO se importan de allá. La
 *  razón es concreta y no estética:
 *
 *  `apps/web/next.config.mjs` lista los 12 paquetes que Next transpila y
 *  `apps/web/package.json` lista sus dependencias. Los dos archivos son de H1 y
 *  el gate de propiedad falla cualquier PR que los toque, así que
 *  `@abraxa/crm` no se puede importar desde aquí todavía: Next intentaría
 *  compilar TypeScript crudo desde `node_modules` y el build reventaría.
 *
 *  Duplicar tipos es deuda, y está declarada: en cuanto H1 agregue
 *  `'@abraxa/crm'` a `transpilePackages` y a las dependencias de la app, este
 *  archivo se borra y las importaciones apuntan al port. Es una línea en cada
 *  archivo y está escrita textual en `docs/handoffs/H15-crm.md` §9.
 *
 *  Mientras tanto, la pantalla habla con la API por HTTP —que es una frontera
 *  de red donde los tipos se validan igual— y no se queda esperando un merge.
 */

export type IdentityChannel = 'whatsapp' | 'instagram' | 'messenger' | 'email' | 'sms' | 'web';

export type Lifecycle = 'lead' | 'prospect' | 'customer' | 'churned' | 'unknown';

export interface ContactIdentity {
  id: string;
  channel: IdentityChannel;
  identifier: string;
  display: string | null;
  verified: boolean;
  isPrimary: boolean;
}

export interface ContactPlacement {
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageSlug: string;
  stageName: string;
  probability: number;
  isWon: boolean;
  isLost: boolean;
  amount: number | null;
  currency: string;
  enteredAt: string;
}

export interface Contact {
  id: string;
  displayName: string | null;
  companyName: string | null;
  ownerEmail: string | null;
  lifecycle: Lifecycle;
  source: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  identities: ContactIdentity[];
  tags: string[];
  placements: ContactPlacement[];
}

export interface ContactEvent {
  id: string;
  contactId: string;
  type: string;
  summary: string;
  actor: string | null;
  source: string;
  occurredAt: string;
}

export interface EtapaConteo {
  stageId: string;
  slug: string;
  name: string;
  count: number;
  amount: number;
}

export interface EstadisticasEmbudo {
  pipelineId: string;
  stages: EtapaConteo[];
}
