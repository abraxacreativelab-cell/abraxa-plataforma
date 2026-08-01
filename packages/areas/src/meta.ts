export const meta = {
  name: '@abraxa/areas',
  handoff: 'H11',
  /**
   * En `true` desde el PR de H11: el paquete siembra el mapa desde la plantilla
   * del giro, evalúa los requisitos contra el negocio real, desbloquea sin que
   * nadie apriete nada, corre el mini-onboarding por área y sirve
   * `AreasPort.listAreas()` — que es lo que hace que el sidebar de H5 deje de
   * usar su mock.
   */
  ready: true,
} as const;
