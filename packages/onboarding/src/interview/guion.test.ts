/**
 * El guion es lo que hace que el agente no repita preguntas. Se prueba como lo
 * que es: una función que arma texto.
 */
import { describe, expect, it } from 'vitest';
import { guionDelTurno, loQueYaSabes } from './guion';
import { ausenciaEnPalabras, loQueRecuerdo, mensajeDeRegreso } from './regreso';
import type { EstadoNegocio } from '../types';

const AVANZADO: EstadoNegocio = {
  agente: 'Nova',
  giro: 'estudio de yoga',
  nicho: 'oficinistas con dolor de espalda',
  etapa: 'operando',
  tamano: '40 alumnos',
  modeloIngreso: 'mensualidad',
  ticket: '$1,200 al mes',
  margen: '50%',
  canales: ['instagram', 'whatsapp'],
  recorrido: [
    { nombre: 'clase de prueba', como: 'se apuntan por DM' },
    { nombre: 'se inscriben', como: 'transferencia' },
    { nombre: 'renuevan', como: 'les recuerdo yo' },
  ],
  herramientas: ['instagram', 'excel'],
  dolores: [{ texto: 'se me olvida cobrar las renovaciones' }],
  senales: { cierreDenegado: true },
};

describe('lo que ya sabes', () => {
  it('escribe todos los datos del negocio con las palabras del dueño', () => {
    const bloque = loQueYaSabes(AVANZADO);

    expect(bloque).toContain('estudio de yoga');
    expect(bloque).toContain('oficinistas con dolor de espalda');
    expect(bloque).toContain('$1,200 al mes');
    expect(bloque).toContain('instagram, whatsapp');
    expect(bloque).toContain('clase de prueba (se apuntan por DM)');
    expect(bloque).toContain('se me olvida cobrar las renovaciones');
  });

  it('el estado de la conversación NO se cuela como si fuera dato del negocio', () => {
    // `senales` vive en la misma columna por atomicidad, pero decirle al modelo
    // "cierreDenegado: true" como si fuera un hecho de la empresa lo confundiría.
    expect(loQueYaSabes(AVANZADO)).not.toContain('cierreDenegado');
    expect(loQueYaSabes(AVANZADO)).not.toContain('senales');
  });

  it('en la primera conversación lo dice, en vez de inventar contexto', () => {
    expect(loQueYaSabes({})).toContain('Es tu primera conversación');
  });
});

describe('el guion del turno', () => {
  it('en el bautizo el agente no tiene nombre y lo pide', () => {
    const g = guionDelTurno('bienvenida', {});
    expect(g).toContain('Todavía no tienes nombre');
    expect(g).toContain('Pídele que te ponga uno');
    expect(g).toContain('puede parar cuando quiera');
  });

  it('después del bautizo el agente usa SU nombre', () => {
    const g = guionDelTurno('identidad', AVANZADO);
    expect(g).toContain('Él te puso Nova');
  });

  it('dice exactamente qué falta para cerrar la fase', () => {
    const g = guionDelTurno('modelo', { agente: 'Nova', giro: 'yoga' });
    expect(g).toContain('LO QUE FALTA PARA CERRAR ESTA FASE');
    expect(g).toContain('cuánto cobra en promedio (su ticket)');
    expect(g).toContain('la fase no avanza aunque emitas [FASE_COMPLETA:modelo]');
  });

  it('cuando la fase ya tiene todo, le dice que cierre sin ceremonia', () => {
    const g = guionDelTurno('identidad', AVANZADO);
    expect(g).toContain('ESTA FASE YA TIENE TODO');
    expect(g).toContain('[FASE_COMPLETA:identidad]');
  });

  it('la fase 4 no se suaviza', () => {
    const g = guionDelTurno('dolor', AVANZADO);
    expect(g).toContain('No preguntes "¿qué te duele?"');
    expect(g).toContain('Atácalo');
    expect(g).toContain('¿y si pasara?');
    expect(g).toContain('no había pedido');
  });

  it('avisa cuando se le negó el cierre en el turno anterior', () => {
    const g = guionDelTurno('modelo', { giro: 'yoga' }, { cierreDenegado: true });
    expect(g).toContain('OJO');
    expect(g).toContain('no repitas la misma pregunta');
  });

  it('documenta los marcadores y prohíbe mostrarlos', () => {
    const g = guionDelTurno('identidad', AVANZADO);
    expect(g).toContain('[DATO:clave=valor]');
    expect(g).toContain('NUNCA los menciones');
  });

  it('cuando vuelve, le pide que lo salude como quien lo recordaba', () => {
    const g = guionDelTurno('proceso', AVANZADO, { regresa: true, ausencia: 'hace 3 días' });
    expect(g).toContain('ÉL ACABA DE VOLVER');
    expect(g).toContain('hace 3 días');
    expect(g).toContain('sin repetir nada');
  });
});

describe('el regreso', () => {
  it('mide la ausencia como la diría una persona', () => {
    const base = new Date('2026-07-30T12:00:00.000Z');
    const antes = (min: number): string =>
      new Date(base.getTime() - min * 60_000).toISOString();

    // Menos de media hora no es una ausencia: es una pausa para pensar.
    expect(ausenciaEnPalabras(antes(10), base)).toBeNull();
    expect(ausenciaEnPalabras(antes(60), base)).toBe('hace un rato');
    expect(ausenciaEnPalabras(antes(60 * 5), base)).toBe('hace 5 horas');
    expect(ausenciaEnPalabras(antes(60 * 30), base)).toBe('ayer');
    expect(ausenciaEnPalabras(antes(60 * 24 * 4), base)).toBe('hace 4 días');
    expect(ausenciaEnPalabras(antes(60 * 24 * 30), base)).toBe('hace 4 semanas');
    expect(ausenciaEnPalabras(null, base)).toBeNull();
    expect(ausenciaEnPalabras('no es una fecha', base)).toBeNull();
  });

  it('recuerda datos concretos, no etiquetas', () => {
    const recuerdos = loQueRecuerdo(AVANZADO);
    expect(recuerdos.length).toBeLessThanOrEqual(4);
    expect(recuerdos.join(' ')).toContain('estudio de yoga');
    expect(recuerdos.join(' ')).toContain('$1,200 al mes');
  });

  it('el mensaje de regreso se arma sin llamar al modelo', () => {
    const m = mensajeDeRegreso(AVANZADO, 'proceso', 'ayer');
    expect(m).toContain('ayer');
    expect(m).toContain('estudio de yoga');
    expect(m).toContain('fase 4 de 7');
    expect(m).toContain('— Nova');
  });
});
