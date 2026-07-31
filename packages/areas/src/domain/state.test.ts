import { describe, expect, it } from 'vitest';
import { evaluate } from './requirements';
import { completeOnboarding, estaAbierta, navegable, reconcile, startOnboarding } from './state';
import { SIGNALS_CERO, type AreaState, type Signals } from './types';

const negocio = (parche: Partial<Signals> = {}): Signals => ({ ...SIGNALS_CERO, ...parche });

const CUMPLE = evaluate([{ type: 'contact_count', min: 5 }], negocio({ contacts_active: 5 }));
const NO_CUMPLE = evaluate([{ type: 'contact_count', min: 5 }], negocio({ contacts_active: 1 }));

describe('criterio 2 — cumplir un requisito desbloquea sola el área', () => {
  it('bloqueada + requisitos cumplidos = disponible, sin que nadie apriete nada', () => {
    expect(reconcile('bloqueada', CUMPLE)).toEqual({
      from: 'bloqueada',
      to: 'disponible',
      changed: true,
      justUnlocked: true,
    });
  });

  it('bloqueada sin cumplir se queda bloqueada', () => {
    expect(reconcile('bloqueada', NO_CUMPLE)).toMatchObject({ to: 'bloqueada', changed: false });
  });

  it('`justUnlocked` marca el INSTANTE de abrirse, y sólo ese', () => {
    // Es lo que dispara el mini-onboarding: si se marcara en cada lectura, el
    // tutorial saldría cada vez que carga la página.
    expect(reconcile('bloqueada', CUMPLE).justUnlocked).toBe(true);
    expect(reconcile('disponible', CUMPLE).justUnlocked).toBe(false);
  });
});

describe('lo que se ganó no se le quita', () => {
  const abiertas: AreaState[] = ['disponible', 'en_progreso', 'activa'];

  it.each(abiertas)('%s no retrocede aunque el requisito deje de cumplirse', (state) => {
    // Borró un contacto y bajó de cinco. El área SIGUE abierta.
    expect(reconcile(state, NO_CUMPLE)).toEqual({
      from: state,
      to: state,
      changed: false,
      justUnlocked: false,
    });
  });

  it('reconciliar dos veces no mueve nada la segunda', () => {
    const primera = reconcile('bloqueada', CUMPLE);
    const segunda = reconcile(primera.to, CUMPLE);
    expect(segunda.changed).toBe(false);
  });

  it('estaAbierta distingue el candado de todo lo demás', () => {
    expect(estaAbierta('bloqueada')).toBe(false);
    expect(estaAbierta('disponible')).toBe(true);
    expect(estaAbierta('en_progreso')).toBe(true);
    expect(estaAbierta('activa')).toBe(true);
  });
});

describe('criterio 3 — la bloqueada se ve, pero no se abre', () => {
  it('bloqueada nunca es navegable, ni con acceso de admin', () => {
    expect(navegable('bloqueada', 'admin')).toBe(false);
  });

  it('sin acceso tampoco se entra, aunque esté activa', () => {
    expect(navegable('activa', null)).toBe(false);
    expect(navegable('activa', undefined)).toBe(false);
  });

  it('abierta y con acceso sí', () => {
    expect(navegable('disponible', 'view')).toBe(true);
    expect(navegable('activa', 'edit')).toBe(true);
  });
});

describe('el mini-onboarding mueve el estado', () => {
  it('empieza sólo desde disponible', () => {
    expect(startOnboarding('disponible')).toMatchObject({ to: 'en_progreso', changed: true });
  });

  it('no se puede tutorizar un área que todavía no se ganó', () => {
    expect(startOnboarding('bloqueada')).toMatchObject({ to: 'bloqueada', changed: false });
  });

  it('no se reinicia una que ya está activa', () => {
    expect(startOnboarding('activa')).toMatchObject({ to: 'activa', changed: false });
    expect(startOnboarding('en_progreso')).toMatchObject({ to: 'en_progreso', changed: false });
  });

  it('terminar el tutorial deja el área activa', () => {
    expect(completeOnboarding('en_progreso')).toMatchObject({ to: 'activa', changed: true });
  });

  it('quien se salta el tutorial y se pone a trabajar también la activa', () => {
    // Bloquear la salida detrás de un tutorial es el ERP que esto no quiere ser.
    expect(completeOnboarding('disponible')).toMatchObject({ to: 'activa', changed: true });
  });

  it('no se activa un área bloqueada por la puerta de atrás', () => {
    expect(completeOnboarding('bloqueada')).toMatchObject({ to: 'bloqueada', changed: false });
  });
});
