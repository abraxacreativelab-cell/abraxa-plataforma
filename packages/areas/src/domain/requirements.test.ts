import { describe, expect, it } from 'vitest';
import {
  completionRatio,
  evaluate,
  parseProgress,
  parseRequirement,
  parseRequirements,
  parseSignals,
} from './requirements';
import { SIGNALS_CERO, type Signals } from './types';

/** Un negocio con algo de camino andado. Se clona en cada prueba que lo toca. */
const negocio = (parche: Partial<Signals> = {}): Signals => ({ ...SIGNALS_CERO, ...parche });

describe('parseRequirement — qué se entiende y qué no', () => {
  it('lee los tipos sin parámetros', () => {
    expect(parseRequirement({ type: 'always' })).toEqual({ type: 'always' });
    expect(parseRequirement({ type: 'manual' })).toEqual({ type: 'manual' });
    expect(parseRequirement({ type: 'pipeline_defined' })).toEqual({ type: 'pipeline_defined' });
  });

  it('un tipo de conteo sin `min` quiere decir "al menos uno"', () => {
    expect(parseRequirement({ type: 'has_channel' })).toEqual({ type: 'has_channel', min: 1 });
  });

  it('acepta un `min` que viene como texto de un UPDATE escrito a mano', () => {
    expect(parseRequirement({ type: 'value_count', min: '3' })).toEqual({
      type: 'value_count',
      min: 3,
    });
  });

  it('un `min: 0` explícito se respeta', () => {
    expect(parseRequirement({ type: 'contact_count', min: 0 })).toEqual({
      type: 'contact_count',
      min: 0,
    });
  });

  it('`declared` sin clave no se entiende: no hay nada que declarar', () => {
    expect(parseRequirement({ type: 'declared' })).toBeNull();
    expect(parseRequirement({ type: 'declared', key: '   ' })).toBeNull();
    expect(parseRequirement({ type: 'declared', key: 'va_a_contratar' })).toEqual({
      type: 'declared',
      key: 'va_a_contratar',
    });
  });

  it('un tipo que la plataforma no conoce NO se entiende', () => {
    expect(parseRequirement({ type: 'lo_que_sea' })).toBeNull();
    expect(parseRequirement({ type: 42 })).toBeNull();
    expect(parseRequirement('has_channel')).toBeNull();
    expect(parseRequirement(null)).toBeNull();
  });

  it('un `any_of` con UNA alternativa rota no se entiende entero', () => {
    // Aceptar sólo las legibles abriría el área por el camino que quedaba, y el
    // camino roto era justamente el que la mantenía cerrada.
    expect(
      parseRequirement({
        type: 'any_of',
        of: [{ type: 'document_count', min: 1 }, { type: 'inventado' }],
      }),
    ).toBeNull();
  });

  it('un `any_of` vacío no dice nada, así que no se entiende', () => {
    expect(parseRequirement({ type: 'any_of', of: [] })).toBeNull();
  });

  it('parseRequirements conserva los ilegibles como null en vez de perderlos', () => {
    expect(parseRequirements([{ type: 'always' }, { type: 'inventado' }])).toEqual([
      { type: 'always' },
      null,
    ]);
    expect(parseRequirements('no es una lista')).toEqual([]);
  });
});

describe('el requisito que no se entiende NO se cumple', () => {
  it('deja el área cerrada y lo dice, en vez de abrirla por omisión', () => {
    const r = evaluate([{ type: 'inventado_por_el_agente' }], negocio());
    expect(r.met).toBe(false);
    expect(r.missing).toEqual(['hay un requisito que este sistema no sabe leer (avísanos)']);
  });

  it('no tumba el resto del mapa: es un área cerrada, no una excepción', () => {
    // Si esto lanzara, un dato malo en Finanzas dejaría al emprendedor sin
    // poder entrar a Ventas.
    expect(() => evaluate([{ type: 'roto' }], negocio())).not.toThrow();
  });

  it('un requisito roto contamina su área aunque los demás se cumplan', () => {
    const r = evaluate([{ type: 'always' }, { type: 'roto' }], negocio());
    expect(r.met).toBe(false);
  });
});

describe('las condiciones de conteo', () => {
  it('has_channel se cumple con un canal ACTIVO', () => {
    expect(evaluate([{ type: 'has_channel', min: 1 }], negocio({ channels_active: 0 })).met).toBe(
      false,
    );
    expect(evaluate([{ type: 'has_channel', min: 1 }], negocio({ channels_active: 1 })).met).toBe(
      true,
    );
  });

  it('pipeline_defined mira las ETAPAS, no que exista el embudo', () => {
    expect(evaluate([{ type: 'pipeline_defined' }], negocio({ pipeline_stages: 0 })).met).toBe(false);
    expect(evaluate([{ type: 'pipeline_defined' }], negocio({ pipeline_stages: 4 })).met).toBe(true);
  });

  it('de más también cuenta: el requisito es un piso, no una igualdad', () => {
    expect(evaluate([{ type: 'contact_count', min: 5 }], negocio({ contacts_active: 9 })).met).toBe(
      true,
    );
  });

  it('redacta lo que falta en segunda persona, para el candado', () => {
    const r = evaluate([{ type: 'contact_count', min: 5 }], negocio({ contacts_active: 2 }));
    expect(r.missing).toEqual(['tienes 5 contactos activos']);
    expect(r.checks[0]?.progress).toEqual({ current: 2, needed: 5 });
  });

  it('singular y plural se redactan distinto', () => {
    expect(evaluate([{ type: 'document_count', min: 1 }], negocio()).missing).toEqual([
      'cargas un documento',
    ]);
    expect(evaluate([{ type: 'document_count', min: 3 }], negocio()).missing).toEqual([
      'cargas 3 documentos',
    ]);
  });
});

describe('la tabla de desbloqueo del handoff §5', () => {
  it('Ventas pide canal Y embudo: las dos', () => {
    const req = [{ type: 'has_channel', min: 1 }, { type: 'pipeline_defined' }];

    // Un canal sin embudo es una bandeja.
    expect(evaluate(req, negocio({ channels_active: 1 })).met).toBe(false);
    // Un embudo sin canal no tiene por dónde entrar nadie.
    expect(evaluate(req, negocio({ pipeline_stages: 3 })).met).toBe(false);
    expect(evaluate(req, negocio({ channels_active: 1, pipeline_stages: 3 })).met).toBe(true);
  });

  it('Dirección pide un documento O tres valores: cualquiera de los dos', () => {
    const req = [
      {
        type: 'any_of',
        of: [
          { type: 'document_count', min: 1 },
          { type: 'value_count', min: 3 },
        ],
      },
    ];

    expect(evaluate(req, negocio()).met).toBe(false);
    expect(evaluate(req, negocio({ documents: 1 })).met).toBe(true);
    expect(evaluate(req, negocio({ values_active: 3 })).met).toBe(true);
    expect(evaluate(req, negocio({ values_active: 2 })).met).toBe(false);
  });

  it('el candado de Dirección lee los dos caminos', () => {
    const r = evaluate(
      [
        {
          type: 'any_of',
          of: [
            { type: 'document_count', min: 1 },
            { type: 'value_count', min: 3 },
          ],
        },
      ],
      negocio(),
    );
    expect(r.missing).toEqual(['cargas un documento o defines 3 valores de tu negocio']);
  });

  it('el progreso del `any_of` es el del camino MÁS avanzado', () => {
    // Le falta 1 documento (0/1 = 0%) y 2 valores (1/3 = 33%). La barra tiene
    // que enseñar el 33%: es por donde va a terminar entrando.
    const r = evaluate(
      [
        {
          type: 'any_of',
          of: [
            { type: 'document_count', min: 1 },
            { type: 'value_count', min: 3 },
          ],
        },
      ],
      negocio({ values_active: 1 }),
    );
    expect(r.checks[0]?.progress).toEqual({ current: 1, needed: 3 });
  });

  it('RH sólo se abre cuando él lo DECLARA: ninguna tabla puede contarlo', () => {
    const req = [{ type: 'declared', key: 'va_a_contratar' }];

    // Ni con el negocio entero andando.
    const prospero = negocio({
      channels_active: 3,
      contacts_active: 400,
      deals_won: 90,
      months_operating: 24,
    });
    expect(evaluate(req, prospero).met).toBe(false);
    expect(evaluate(req, prospero).missing).toEqual(['nos dices que vas a contratar']);

    expect(evaluate(req, negocio(), parseProgress({ declared: { va_a_contratar: true } })).met).toBe(
      true,
    );
  });

  it('una declaración que no es exactamente `true` no cuenta', () => {
    const req = [{ type: 'declared', key: 'va_a_contratar' }];
    const p = parseProgress({ declared: { va_a_contratar: 'sí' } });
    expect(evaluate(req, negocio(), p).met).toBe(false);
  });

  it('Finanzas espera tres meses de operación', () => {
    const req = [{ type: 'months_operating', min: 3 }];
    expect(evaluate(req, negocio({ months_operating: 2 })).met).toBe(false);
    expect(evaluate(req, negocio({ months_operating: 3 })).met).toBe(true);
  });

  it('Onboarding espera la primera venta cerrada en el sistema', () => {
    const req = [{ type: 'deal_won', min: 1 }];
    expect(evaluate(req, negocio({ contacts_active: 50 })).met).toBe(false);
    expect(evaluate(req, negocio({ deals_won: 1 })).met).toBe(true);
  });
});

describe('criterio 5 — cambiar el DATO cambia el comportamiento', () => {
  it('el mismo negocio abre o no según lo que diga `requirements`', () => {
    // Este es el criterio observable entero, y por eso el evaluador es puro:
    // lo único que cambia entre las dos líneas es el dato de la base.
    const mismoNegocio = negocio({ contacts_active: 3 });

    expect(evaluate([{ type: 'contact_count', min: 5 }], mismoNegocio).met).toBe(false);
    expect(evaluate([{ type: 'contact_count', min: 3 }], mismoNegocio).met).toBe(true);
  });

  it('el agente maestro puede endurecer una condición sin desplegar nada', () => {
    const n = negocio({ documents: 2 });
    expect(evaluate([{ type: 'document_count', min: 2 }], n).met).toBe(true);
    expect(evaluate([{ type: 'document_count', min: 10 }], n).met).toBe(false);
  });
});

describe('los bordes de la lista', () => {
  it('una lista vacía se cumple: no hay nada que pedir', () => {
    expect(evaluate([], negocio()).met).toBe(true);
    expect(evaluate([], negocio()).missing).toEqual([]);
  });

  it('para "no se abre sola" está `manual`, que es explícito', () => {
    const r = evaluate([{ type: 'manual' }], negocio());
    expect(r.met).toBe(false);
    expect(r.missing).toEqual(['la abres tú cuando quieras']);
  });

  it('`always` se cumple con el negocio en cero', () => {
    expect(evaluate([{ type: 'always' }], negocio()).met).toBe(true);
  });

  it('un `requirements` que no es una lista se trata como vacío', () => {
    expect(evaluate(null, negocio()).met).toBe(true);
    expect(evaluate({ type: 'always' }, negocio()).met).toBe(true);
  });
});

describe('completionRatio — la barra del candado', () => {
  it('sin condiciones está completo', () => {
    expect(completionRatio(evaluate([], negocio()))).toBe(1);
  });

  it('a la mitad del conteo va a la mitad', () => {
    const r = evaluate([{ type: 'contact_count', min: 4 }], negocio({ contacts_active: 2 }));
    expect(completionRatio(r)).toBe(0.5);
  });

  it('dos condiciones, una cumplida y otra a cero, van a la mitad', () => {
    const r = evaluate(
      [{ type: 'has_channel', min: 1 }, { type: 'pipeline_defined' }],
      negocio({ channels_active: 1 }),
    );
    expect(completionRatio(r)).toBe(0.5);
  });

  it('pasarse de la meta no da más de 1', () => {
    const r = evaluate([{ type: 'contact_count', min: 2 }], negocio({ contacts_active: 200 }));
    expect(completionRatio(r)).toBe(1);
  });

  it('una declaración pendiente vale cero: no hay media declaración', () => {
    const r = evaluate([{ type: 'declared', key: 'va_a_contratar' }], negocio());
    expect(completionRatio(r)).toBe(0);
  });
});

describe('lo que llega de la base, saneado', () => {
  it('parseSignals rellena lo que falte con cero', () => {
    expect(parseSignals({ contacts_active: 4 })).toEqual({ ...SIGNALS_CERO, contacts_active: 4 });
    expect(parseSignals(null)).toEqual(SIGNALS_CERO);
    expect(parseSignals({ contacts_active: 'ocho' })).toEqual(SIGNALS_CERO);
  });

  it('parseSignals ignora claves que no son señales', () => {
    expect(parseSignals({ contacts_active: 1, inventada: 99 })).toEqual({
      ...SIGNALS_CERO,
      contacts_active: 1,
    });
  });

  it('parseProgress nunca devuelve `declared` sin objeto', () => {
    expect(parseProgress(null).declared).toEqual({});
    expect(parseProgress({ declared: 'sí' }).declared).toEqual({});
    expect(parseProgress({ declared: { a: true, b: 1 } }).declared).toEqual({ a: true, b: false });
  });
});
