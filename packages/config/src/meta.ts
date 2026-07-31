/** Lo importa `apps/api` para reportar en `GET /_health/packages`. */
export const meta = {
  name: '@abraxa/config',
  handoff: 'H1',
  /** `true` cuando el paquete ya hace su trabajo de verdad. */
  ready: true,
} as const;
