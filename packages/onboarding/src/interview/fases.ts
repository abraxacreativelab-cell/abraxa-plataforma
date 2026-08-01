/**
 * Las 7 fases del Ritual (handoff §5), y el progreso que se le enseña.
 *
 * El orden vive aquí y en el CHECK de la migración 050. En ningún otro lado.
 */
import type { Fase } from '../types';

export const FASES: readonly Fase[] = [
  'bienvenida',
  'identidad',
  'modelo',
  'proceso',
  'dolor',
  'gente',
  'sintesis',
] as const;

export interface FichaDeFase {
  /** Lo que ve el emprendedor en la barra de progreso. */
  titulo: string;
  /** Una línea sobre qué se va a hablar. Baja la ansiedad de "¿cuánto falta?". */
  promesa: string;
}

export const FICHAS: Record<Fase, FichaDeFase> = {
  bienvenida: {
    titulo: 'El bautizo',
    promesa: 'Le pones nombre a tu agente.',
  },
  identidad: {
    titulo: 'Tu negocio',
    promesa: 'A qué te dedicas y en qué punto vas.',
  },
  modelo: {
    titulo: 'Cómo ganas dinero',
    promesa: 'Qué cobras, cuánto y por dónde te llegan.',
  },
  proceso: {
    titulo: 'Tu proceso',
    promesa: 'Cómo es hoy, de que te buscan hasta que te pagan.',
  },
  dolor: {
    titulo: 'Dónde se rompe',
    promesa: 'Qué te roba tiempo y dinero. Aquí se pone incómodo.',
  },
  gente: {
    titulo: 'Tu gente',
    promesa: 'Si estás solo, con equipo, o vas a contratar.',
  },
  sintesis: {
    titulo: 'Tu Mapa de Negocio',
    promesa: 'Lo que sigue para tu empresa, en orden.',
  },
};

export function indiceDeFase(f: Fase): number {
  const i = FASES.indexOf(f);
  return i === -1 ? 0 : i;
}

/** La siguiente fase, o `null` si `sintesis` ya es la última. */
export function siguienteFase(f: Fase): Fase | null {
  return FASES[indiceDeFase(f) + 1] ?? null;
}

/**
 * Progreso 0–100 por FASES CERRADAS, no por mensajes.
 *
 * Es la diferencia entre una barra honesta y una que se mueve sola: contar
 * mensajes haría que una fase larga pareciera avance cuando no lo hubo, y el
 * handoff §8 pide justo lo contrario — "sin esto se siente infinito".
 */
export function progresoDe(f: Fase, completada: boolean): number {
  const cerradas = completada ? FASES.length : indiceDeFase(f);
  return Math.round((cerradas / FASES.length) * 100);
}
