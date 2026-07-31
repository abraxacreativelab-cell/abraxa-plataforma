/**
 * Las cuatro tablas de H8, declaradas para que `tenantDb(ctx).from('flows')`
 * compile. Sin este paso el compilador frena, y es a propósito: una tabla que
 * no está aquí es una tabla a la que nadie declaró que iba a hablarle.
 *
 * Ver CONTRIBUTING.md § El aislamiento entre clientes.
 */
declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    flows: true;
    flow_versions: true;
    flow_runs: true;
    flow_steps: true;
  }
}
