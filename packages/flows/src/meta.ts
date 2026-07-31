export const meta = {
  name: '@abraxa/flows',
  handoff: 'H8',
  /**
   * `true` desde el 2026-07-31: el paquete ejecuta flujos de verdad.
   *
   * Implementa `FlowPort` (registrado en `src/index.ts`), corre los diez nodos
   * del catálogo contra los ports de H6, H15, H9 y H3, versiona y restaura, y
   * expone sus rutas bajo `/flows`.
   *
   * Lo que todavía NO puede hacer, y no se disfraza: sin `DATABASE_URL` no hay
   * cola (el schema `pgboss` aún no existe en la base), así que las corridas
   * quedan en `paused` con su razón escrita hasta que la haya. Ver
   * `src/queue.ts`.
   */
  ready: true,
} as const;
