import { describe, expect, it } from 'vitest';
import { decidirSiContesta, pausaVigente, type EntradaDecision } from './decide';

const AHORA = new Date('2026-07-31T18:00:00Z'); // viernes, 12:00 en CDMX

function entrada(sobre: {
  canal?: Partial<EntradaDecision['canal']>;
  hilo?: Partial<EntradaDecision['hilo']>;
  mensaje?: Partial<EntradaDecision['mensaje']>;
} = {}): EntradaDecision {
  return {
    canal: {
      ai_enabled: true,
      agent_role: 'sales',
      business_hours: {},
      ai_outside_hours: true,
      ...sobre.canal,
    },
    hilo: { ai_enabled: true, assigned_to: null, ai_paused_until: null, ...sobre.hilo },
    mensaje: { body: '¿a qué hora abren?', ...sobre.mensaje },
  };
}

describe('decidirSiContesta', () => {
  it('contesta el caso normal: hilo abierto, IA encendida, nadie atendiéndolo', () => {
    expect(decidirSiContesta(entrada(), AHORA)).toEqual({ responde: true });
  });

  // ── Criterio #3 · no se negocia ──────────────────────────────────────────
  it('se calla en cuanto un humano tiene el hilo', () => {
    const d = decidirSiContesta(entrada({ hilo: { assigned_to: 'santiago@abraxa.club' } }), AHORA);
    expect(d).toEqual({ responde: false, razon: 'humano_en_el_hilo' });
  });

  it('el humano gana sobre cualquier otra condición que también aplicaría', () => {
    // Fuera de horario Y con la IA apagada Y con humano: la razón que le sirve
    // a quien lee el hilo es que hay un humano.
    const d = decidirSiContesta(
      entrada({
        canal: { ai_enabled: false, ai_outside_hours: false },
        hilo: { assigned_to: 'ana@empresa.mx', ai_enabled: false },
      }),
      AHORA,
    );
    expect(d).toEqual({ responde: false, razon: 'humano_en_el_hilo' });
  });

  it('vuelve a contestar cuando el humano suelta el hilo', () => {
    expect(decidirSiContesta(entrada({ hilo: { assigned_to: null } }), AHORA).responde).toBe(true);
  });

  // ── El interruptor por hilo — el campo que GARDEN nunca leyó ─────────────
  it('respeta ai_enabled del hilo', () => {
    expect(decidirSiContesta(entrada({ hilo: { ai_enabled: false } }), AHORA)).toEqual({
      responde: false,
      razon: 'hilo_sin_ia',
    });
  });

  it('respeta ai_enabled del canal', () => {
    expect(decidirSiContesta(entrada({ canal: { ai_enabled: false } }), AHORA)).toEqual({
      responde: false,
      razon: 'canal_sin_ia',
    });
  });

  // ── Pausa ────────────────────────────────────────────────────────────────
  it('calla mientras la pausa siga vigente', () => {
    const d = decidirSiContesta(
      entrada({ hilo: { ai_paused_until: '2026-07-31T19:00:00Z' } }),
      AHORA,
    );
    expect(d).toEqual({ responde: false, razon: 'ia_en_pausa' });
  });

  it('vuelve sola cuando la pausa venció', () => {
    const d = decidirSiContesta(
      entrada({ hilo: { ai_paused_until: '2026-07-31T17:59:59Z' } }),
      AHORA,
    );
    expect(d.responde).toBe(true);
  });

  it('una fecha de pausa ilegible no calla al agente para siempre', () => {
    expect(decidirSiContesta(entrada({ hilo: { ai_paused_until: 'ayer' } }), AHORA).responde).toBe(
      true,
    );
  });

  // ── Ecos y mensajes sin texto ────────────────────────────────────────────
  it('no contesta el eco de un saliente nuestro', () => {
    expect(decidirSiContesta(entrada({ mensaje: { fromMe: true } }), AHORA)).toEqual({
      responde: false,
      razon: 'eco_propio',
    });
  });

  it('no contesta un mensaje sin texto', () => {
    expect(decidirSiContesta(entrada({ mensaje: { body: '   ' } }), AHORA)).toEqual({
      responde: false,
      razon: 'sin_texto',
    });
    expect(decidirSiContesta(entrada({ mensaje: { body: null } }), AHORA).responde).toBe(false);
  });

  it('no contesta si el canal no tiene agente asignado', () => {
    expect(decidirSiContesta(entrada({ canal: { agent_role: null } }), AHORA)).toEqual({
      responde: false,
      razon: 'sin_agente',
    });
  });

  // ── Criterio #8 · horario de atención ────────────────────────────────────
  describe('horario de atención', () => {
    const nueveASeis = {
      tz: 'America/Mexico_City',
      semana: { vie: [['09:00', '18:00']] as Array<[string, string]> },
    };

    it('sin horario configurado contesta siempre — es la promesa del producto', () => {
      const medianoche = new Date('2026-07-31T08:00:00Z'); // 02:00 en CDMX
      expect(
        decidirSiContesta(entrada({ canal: { ai_outside_hours: false } }), medianoche).responde,
      ).toBe(true);
    });

    it('dentro del horario contesta aunque el canal pida silencio fuera', () => {
      const d = decidirSiContesta(
        entrada({ canal: { business_hours: nueveASeis, ai_outside_hours: false } }),
        AHORA, // viernes 12:00 CDMX
      );
      expect(d.responde).toBe(true);
    });

    it('fuera del horario se calla cuando el canal lo pidió', () => {
      const nocturno = new Date('2026-07-31T06:00:00Z'); // viernes 00:00 CDMX
      const d = decidirSiContesta(
        entrada({ canal: { business_hours: nueveASeis, ai_outside_hours: false } }),
        nocturno,
      );
      expect(d).toEqual({ responde: false, razon: 'fuera_de_horario' });
    });

    it('fuera del horario SÍ contesta si el emprendedor lo dejó encendido', () => {
      const nocturno = new Date('2026-07-31T06:00:00Z');
      const d = decidirSiContesta(
        entrada({ canal: { business_hours: nueveASeis, ai_outside_hours: true } }),
        nocturno,
      );
      expect(d.responde).toBe(true);
    });
  });
});

describe('pausaVigente', () => {
  it('null y vacío no son pausa', () => {
    expect(pausaVigente(null, AHORA)).toBe(false);
    expect(pausaVigente(undefined, AHORA)).toBe(false);
    expect(pausaVigente('', AHORA)).toBe(false);
  });

  it('el instante exacto del vencimiento ya no es pausa', () => {
    expect(pausaVigente(AHORA.toISOString(), AHORA)).toBe(false);
  });
});
