/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las 7 fases del Ritual (handoff §5), y el progreso que se le enseña.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El orden vive aquí. El CHECK de la migración 050 enumera los MISMOS SIETE
 *  nombres pero como conjunto —`phase IN (…)`—, así que reordenarlos aquí no
 *  toca la base: ninguna fila deja de ser válida y nadie tiene que migrar nada.
 *  Lo único que la 050 clava de verdad es el DEFAULT, `'bienvenida'`, y por eso
 *  el bautizo sigue siendo la primera.
 *
 *  ── El embudo invertido (2026-08-01) ──────────────────────────────────────
 *
 *  Hasta hoy el Ritual preguntaba mucho y entregaba al final: la fase 5 era
 *  'dolor' —la más lenta, la más incómoda— y 'gente' cerraba con un dato de un
 *  toque. Quien se salía a los diez minutos se iba con las manos vacías, y el
 *  producto se quedaba sin nada que construirle.
 *
 *  Ahora es al revés y la regla es una sola: **lo que se contesta con el pulgar
 *  va primero; lo que hay que pensar va después.** Las dos consecuencias:
 *
 *   1. La fase 1 ('identidad') pide categoría, cuántos son, a qué se dedica y en
 *      qué etapa va — tres botones y una frase. Con eso el mapa ya distingue
 *      este negocio de otro, así que abandonar temprano ya no cuesta todo.
 *   2. 'dolor' se movió al final, pegada a la síntesis. Es la fase que da el
 *      "wow" (el hito que él no había pedido) y ahora ese wow aterriza justo
 *      antes del Mapa de Negocio, no cinco minutos antes de un trámite.
 *
 *  Lo que NO cambió: cada fase sigue teniendo condiciones de cierre duras
 *  (cierre.ts) y `[FASE_COMPLETA:x]` sigue siendo una petición. Ir más rápido no
 *  es preguntar menos, es preguntar mejor.
 */
import type { Fase } from '../types';

export const FASES: readonly Fase[] = [
  'bienvenida',
  'identidad',
  'modelo',
  'proceso',
  'gente',
  'dolor',
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
    titulo: 'Lo esencial',
    promesa: 'Cuatro toques y ya tienes mapa.',
  },
  modelo: {
    titulo: 'Cómo ganas dinero',
    promesa: 'Qué cobras, cuánto y por dónde te llegan.',
  },
  proceso: {
    titulo: 'Tu proceso',
    promesa: 'Cómo es hoy, de que te buscan hasta que te pagan.',
  },
  gente: {
    titulo: 'Tu gente',
    promesa: 'Quién hace qué, y qué soltarías primero.',
  },
  dolor: {
    titulo: 'Dónde se rompe',
    promesa: 'Qué te roba tiempo y dinero. Aquí se pone incómodo.',
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
