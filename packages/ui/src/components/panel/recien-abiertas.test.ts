import { describe, expect, it } from 'vitest';
import type { AreaSummary } from '@abraxa/db/ports';
import {
  areasRecienAbiertas,
  llaveDeMemoria,
  leerMemoria,
  guardarMemoria,
  slugsCerrados,
} from './recien-abiertas';

/**
 * Lo que se verifica aquí NO es que `localStorage` funcione. Es el criterio:
 *
 *   · nadie ve un festejo que no se ganó,
 *   · quien sí se lo ganó lo ve UNA vez y no en cada recarga,
 *   · y el panel de una empresa no festeja el avance de otra.
 */

const area = (slug: string, abierta: boolean): AreaSummary => ({
  slug,
  label: slug,
  icon: 'target',
  position: 1,
  state: abierta ? 'activa' : 'bloqueada',
  access: abierta ? 'admin' : null,
  blurb: '',
  tools: [],
});

const CUATRO = (abiertas: string[]): AreaSummary[] =>
  ['ventas', 'direccion', 'finanzas', 'operaciones'].map((s) => area(s, abiertas.includes(s)));

describe('qué se guarda', () => {
  it('lo CERRADO, que es lo único que no miente sin memoria previa', () => {
    expect(slugsCerrados(CUATRO(['ventas']))).toEqual(['direccion', 'finanzas', 'operaciones']);
  });

  it('sin áreas todavía, no hay nada que recordar', () => {
    expect(slugsCerrados(null)).toEqual([]);
    expect(slugsCerrados([])).toEqual([]);
  });

  it('un área "disponible" cuenta como abierta: se puede entrar', () => {
    const disponible: AreaSummary = { ...area('ventas', true), state: 'disponible' };
    expect(slugsCerrados([disponible])).toEqual([]);
  });

  it('un estado abierto SIN acceso sigue contando como cerrada — isNavigable exige las dos', () => {
    const sinAcceso: AreaSummary = { ...area('ventas', true), access: null };
    expect(slugsCerrados([sinAcceso])).toEqual(['ventas']);
  });
});

describe('la primera visita no festeja nada', () => {
  it('sin memoria, ningún área es "recién abierta" aunque estén todas abiertas', () => {
    expect(areasRecienAbiertas(null, CUATRO(['ventas', 'direccion', 'finanzas']))).toEqual([]);
  });

  it('con memoria vacía tampoco: estuvo aquí y no tenía nada cerrado', () => {
    expect(areasRecienAbiertas([], CUATRO(['ventas']))).toEqual([]);
  });
});

describe('el momento, exactamente una vez', () => {
  it('festeja SÓLO la que pasó de candado a abierta', () => {
    const memoria = ['direccion', 'finanzas', 'operaciones']; // ventas ya estaba abierta
    expect(areasRecienAbiertas(memoria, CUATRO(['ventas', 'direccion']))).toEqual(['direccion']);
  });

  it('festeja varias si el Ritual abrió varias de un jalón', () => {
    const memoria = ['direccion', 'finanzas', 'operaciones'];
    const abiertas = areasRecienAbiertas(memoria, CUATRO(['ventas', 'direccion', 'finanzas']));
    expect(abiertas).toEqual(['direccion', 'finanzas']);
  });

  it('en la recarga siguiente ya no festeja: la memoria se actualizó', () => {
    const antes = ['direccion', 'finanzas', 'operaciones'];
    const ahora = CUATRO(['ventas', 'direccion']);

    expect(areasRecienAbiertas(antes, ahora)).toEqual(['direccion']);

    // Lo que el panel guarda después de pintar.
    const despues = slugsCerrados(ahora);
    expect(areasRecienAbiertas(despues, ahora)).toEqual([]);
  });

  it('un área que se CIERRA no festeja nada — y no revienta', () => {
    expect(areasRecienAbiertas(['finanzas'], CUATRO([]))).toEqual([]);
  });

  it('un slug recordado que ya ni existe se ignora', () => {
    expect(areasRecienAbiertas(['area-que-ya-no-existe'], CUATRO(['ventas']))).toEqual([]);
  });
});

describe('una empresa no festeja el avance de otra', () => {
  it('la llave lleva el slug de la empresa', () => {
    expect(llaveDeMemoria('taqueria-regia-mg34yjj6')).not.toBe(
      llaveDeMemoria('santiago-alcala-c-oyz07q97'),
    );
  });

  it('sin empresa la llave sigue siendo estable y no choca con ninguna real', () => {
    expect(llaveDeMemoria(null)).toBe(llaveDeMemoria(undefined));
    expect(llaveDeMemoria(null)).toContain('sin-empresa');
  });
});

describe('sin localStorage no se rompe nada', () => {
  it('leer devuelve null y guardar no lanza (entorno node: no hay localStorage)', () => {
    expect(typeof localStorage).toBe('undefined');
    expect(leerMemoria(llaveDeMemoria('x'))).toBeNull();
    expect(() => guardarMemoria(llaveDeMemoria('x'), ['ventas'])).not.toThrow();
  });

  it('memoria corrupta se trata como si no hubiera: no festeja de más', () => {
    const fake: Record<string, string> = { k: '{"esto":"no es un arreglo"}', j: 'no-es-json' };
    const stub = {
      getItem: (k: string) => fake[k] ?? null,
      setItem: () => undefined,
    };
    (globalThis as { localStorage?: unknown }).localStorage = stub;

    try {
      expect(leerMemoria('k')).toBeNull();
      expect(leerMemoria('j')).toBeNull();
      // Y con `null` como memoria, no hay festejo.
      expect(areasRecienAbiertas(leerMemoria('k'), CUATRO(['ventas']))).toEqual([]);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
