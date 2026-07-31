/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EL CABLEADO CENTRAL. H1 lo escribió una vez. NADIE lo vuelve a editar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Los 12 paquetes ya están importados y los 9 routers de backend ya están
 * montados. Si estás construyendo un handoff y crees que necesitas tocar este
 * archivo, no lo necesitas: cuelga tus rutas del `router` que tu paquete ya
 * exporta y aparecerán solas bajo tu prefijo.
 *
 * Éste era el archivo destinado a ser el punto de colisión número uno del
 * repo. Por eso está terminado antes de que empiece nadie.
 */
import type { Router } from 'express';

// ── Los 12 paquetes, por su entrada `./meta` (no arrastra React ni Express) ──
import { meta as configMeta } from '@abraxa/config/meta';
import { meta as dbMeta } from '@abraxa/db/meta';
import { meta as tenancyMeta } from '@abraxa/tenancy/meta';
import { meta as agentsMeta } from '@abraxa/agents/meta';
import { meta as vaultMeta } from '@abraxa/vault/meta';
import { meta as uiMeta } from '@abraxa/ui/meta';
import { meta as inboxMeta } from '@abraxa/inbox/meta';
import { meta as onboardingMeta } from '@abraxa/onboarding/meta';
import { meta as flowsMeta } from '@abraxa/flows/meta';
import { meta as workMeta } from '@abraxa/work/meta';
import { meta as billingMeta } from '@abraxa/billing/meta';
import { meta as areasMeta } from '@abraxa/areas/meta';

// ── Los 9 routers de backend. Importarlos también dispara su registerPort(). ──
import { router as tenancyRouter } from '@abraxa/tenancy';
import { router as agentsRouter } from '@abraxa/agents';
import { router as vaultRouter } from '@abraxa/vault';
import { router as inboxRouter } from '@abraxa/inbox';
import { router as onboardingRouter } from '@abraxa/onboarding';
import { router as flowsRouter } from '@abraxa/flows';
import { router as workRouter } from '@abraxa/work';
import { router as billingRouter } from '@abraxa/billing';
import { router as areasRouter } from '@abraxa/areas';

export interface PackageMeta {
  readonly name: string;
  readonly handoff: string;
  readonly ready: boolean;
}

/** Los 12. `apps/api` los importa todos: criterio #3 de H1. */
export const PACKAGE_META: readonly PackageMeta[] = [
  configMeta,
  dbMeta,
  tenancyMeta,
  agentsMeta,
  vaultMeta,
  uiMeta,
  inboxMeta,
  onboardingMeta,
  flowsMeta,
  workMeta,
  billingMeta,
  areasMeta,
];

/** Prefijo público → router del paquete dueño. */
export const MOUNTS: ReadonlyArray<readonly [string, Router]> = [
  ['/tenants', tenancyRouter],
  ['/agents', agentsRouter],
  ['/vault', vaultRouter],
  ['/inbox', inboxRouter],
  ['/onboarding', onboardingRouter],
  ['/flows', flowsRouter],
  ['/work', workRouter],
  ['/billing', billingRouter],
  ['/areas', areasRouter],
];
