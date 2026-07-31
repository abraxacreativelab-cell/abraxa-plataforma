/**
 * Registro de tablas de dominio con `tenant_id`.
 *
 * ── Cómo agregas las tuyas (2 minutos, dentro de TU paquete) ────────────────
 *
 *   // packages/inbox/src/tables.d.ts   ← tuyo, nadie más lo toca
 *   declare module '@abraxa/db/tables' {
 *     interface DomainTableRegistry {
 *       threads: true;
 *       messages: true;
 *       channels: true;
 *     }
 *   }
 *
 * Y ya: `tenantDb(ctx).from('threads')` compila. Sin ese paso el compilador te
 * frena, y eso es a propósito — una tabla que nadie declaró como aislada por
 * tenant no debería ser accesible por la vía aislada.
 *
 * Las tablas GLOBALES (sin `tenant_id`: app.users, app.plans,
 * app.industry_templates, app.billing_events) NO van aquí. Se tocan con
 * `adminDb()` desde el servicio que las administra, y su migración lo declara
 * con `-- tenantless: <razón>`.
 */
export interface DomainTableRegistry {
  memberships: true;
  area_grants: true;
}

/** Nombre de tabla (sin el prefijo `app.`) accesible vía `tenantDb`. */
export type DomainTable = keyof DomainTableRegistry & string;

/** El schema donde vive todo el dominio. `public` queda para Supabase. */
export const APP_SCHEMA = 'app' as const;
