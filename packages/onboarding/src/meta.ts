export const meta = {
  name: '@abraxa/onboarding',
  handoff: 'H7',
  /** El Ritual entrevista, guarda checkpoint en cada turno, reanuda y entrega
   *  su Mapa de Negocio. Lo que falta —proyectarlo a `tenant_areas`— espera al
   *  `BlueprintSink` de H11; ver src/ports/blueprint-sink.ts. */
  ready: true,
} as const;
