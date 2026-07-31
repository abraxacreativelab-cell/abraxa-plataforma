export const meta = {
  name: '@abraxa/inbox',
  handoff: 'H6',
  /**
   * `true`: el paquete ya hace su trabajo. El modelo multicanal, el driver de
   * WhatsApp y el puente agente↔inbox están construidos y probados con dobles.
   * Lo que falta para llamarlo terminado no es código — es un número de
   * WhatsApp conectado y una llave de Anthropic. Está anotado en el PR.
   */
  ready: true,
} as const;
