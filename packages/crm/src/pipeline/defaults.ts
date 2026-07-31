/**
 * El embudo con el que arranca un negocio.
 *
 * Los nombres vienen de `DEFAULT_STAGES` de GARDEN (pipelines/service.ts:52),
 * que llevan dos años en producción y son los que el mercado reconoce. Se
 * agregan dos cosas que allá faltaban y se sentían:
 *
 *  · **Perdido.** GARDEN tiene "Ganado" pero no su contrario, así que un lead
 *    que dice que no se queda para siempre en "Negociación" inflando el
 *    tablero. Un embudo sin salida por abajo miente sobre cuánto hay vivo.
 *  · **`slug`.** Allá la etapa se identifica por uuid, así que el asistente en
 *    español de H8 tiene que resolver un id antes de poder decir "muévelo a
 *    Contactado". Con slug, `moveStage(ctx, { stage: 'contactado' })` funciona
 *    tal cual, y renombrar la etapa no rompe el flujo que la menciona.
 */

export interface EtapaSemilla {
  slug: string;
  name: string;
  probability: number;
  isWon?: boolean;
  isLost?: boolean;
}

export const EMBUDO_POR_DEFECTO = {
  slug: 'ventas',
  name: 'Ventas',
} as const;

export const ETAPAS_POR_DEFECTO: readonly EtapaSemilla[] = [
  { slug: 'nuevo', name: 'Nuevo', probability: 10 },
  { slug: 'contactado', name: 'Contactado', probability: 25 },
  { slug: 'calificado', name: 'Calificado', probability: 50 },
  { slug: 'propuesta', name: 'Propuesta', probability: 70 },
  { slug: 'negociacion', name: 'Negociación', probability: 85 },
  { slug: 'ganado', name: 'Ganado', probability: 100, isWon: true },
  { slug: 'perdido', name: 'Perdido', probability: 0, isLost: true },
];
