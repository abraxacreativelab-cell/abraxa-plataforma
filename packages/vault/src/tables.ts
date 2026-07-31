/**
 * Las tablas de la bóveda, declaradas como aisladas por tenant.
 *
 * Sin este archivo `tenantDb(ctx).from('canonical_values')` no compila — y eso
 * es a propósito: una tabla que nadie declaró como aislada no debería ser
 * alcanzable por la vía aislada.
 *
 * `app.industry_templates` NO va aquí: es catálogo de la plataforma, no tiene
 * `tenant_id`, y se lee con `adminDb()` desde `industry/catalog.ts`.
 *
 * Va en un `.ts` y no en un `.d.ts` —aunque H1 documente el `.d.ts`— porque
 * nadie importa una declaración suelta: el tsconfig de los paquetes de backend
 * la alcanza por su glob, pero el de `apps/web` sólo compila lo que llega por
 * un import. `types.ts` hace `import './tables'` para traerla, y ESLint prohíbe
 * la alternativa (`/// <reference>`).
 */
declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    documents: true;
    document_versions: true;
    canonical_values: true;
    knowledge_chunks: true;
  }
}

export {};
