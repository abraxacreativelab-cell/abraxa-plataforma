/**
 * La proyección del Ritual al mapa, probada contra el blueprint REAL.
 *
 * ── Por qué el fixture es literal ──────────────────────────────────────────
 *
 * `BLUEPRINT_DE_PRODUCCION` es la fila `ce22631b-c0ed-4796-8ccb-4a9aed578c35` de
 * `app.onboarding_blueprints`, leída de producción el 2026-08-01 con la sesión
 * en sólo lectura. Es el único blueprint que existe: el de la empresa que hizo
 * el Ritual completo y se quedó con el panel genérico.
 *
 * Escribirlo a mano "más o menos" no habría servido para nada. El defecto que
 * estas pruebas cachan —`has_pipeline`, `first_sale`, `declares_hiring`, que el
 * evaluador NO entiende— sólo existe porque el agente eligió esas palabras, y
 * un fixture inventado habría usado las del catálogo y habría pasado en verde
 * mientras el cliente de verdad se quedaba con tres áreas que no abren nunca.
 */
import { describe, expect, it } from 'vitest';
import { evaluate } from './requirements';
import { SIGNALS_CERO, type Signals, type TenantAreaRow } from './types';
import {
  hitosQueFaltan,
  leerBlueprint,
  planDeArea,
  planDeProyeccion,
  traducirRequisito,
  traducirRequisitos,
} from './blueprint';

const AHORA = '2026-08-01T13:00:00.000Z';

/** La fila de producción, tal cual. */
const BLUEPRINT_DE_PRODUCCION = {
  id: 'ce22631b-c0ed-4796-8ccb-4a9aed578c35',
  industryType: null,
  areas: [
    {
      slug: 'ventas',
      label: 'Ventas y marketing',
      estado: 'en_progreso',
      blurb: 'Un equipo de ventas que nunca duerme.',
      position: 1,
      razon: 'Le llegan por WhatsApp y no da abasto.',
      requisitos: [
        { min: 1, type: 'has_channel', label: 'conectar al menos un canal por donde te escriben' },
        { type: 'has_pipeline', label: 'definir las etapas por las que pasa un cliente' },
      ],
    },
    {
      slug: 'servicio',
      label: 'Servicio y atención',
      estado: 'disponible',
      blurb: 'Dejar de perder clientes por no contestar.',
      position: 2,
      razon: '',
      requisitos: [
        { min: 5, type: 'contact_count', label: 'tener 5 contactos activos en el sistema' },
      ],
    },
    {
      slug: 'direccion',
      label: 'Dirección',
      estado: 'disponible',
      blurb: 'Tus números en un solo lugar, para que nada más mienta.',
      position: 3,
      razon: '',
      requisitos: [
        { min: 3, type: 'value_count', label: 'definir 3 valores canónicos del negocio' },
        { min: 1, type: 'document_count', label: 'o cargar un documento tuyo' },
      ],
    },
    {
      slug: 'onboarding',
      label: 'Onboarding de clientes',
      estado: 'bloqueada',
      blurb: 'Cómo se siente entrar a tu negocio siendo cliente.',
      position: 4,
      razon: '',
      requisitos: [{ type: 'first_sale', label: 'cerrar tu primera venta dentro del sistema' }],
    },
    {
      slug: 'rh',
      label: 'Equipo',
      estado: 'disponible',
      blurb: 'Graduarte de solopreneur.',
      position: 5,
      razon: '',
      requisitos: [{ type: 'declares_hiring', label: 'decir que vas a sumar a alguien' }],
    },
    {
      slug: 'finanzas',
      label: 'Finanzas',
      estado: 'disponible',
      blurb: 'Saber si de verdad ganas.',
      position: 6,
      razon: '',
      requisitos: [
        { min: 3, type: 'months_operating', label: 'tener 3 meses de operación registrada' },
      ],
    },
  ],
  hitos: [
    {
      areaSlug: 'rh',
      titulo:
        'hacer una lista de precios fija y visible (impresa o en la caja) para que cualquiera pueda cobrar sin depender de la memoria de Beto',
      detalle: null,
      origen: 'abogado_del_diablo',
    },
    {
      areaSlug: 'onboarding',
      titulo: 'Para abrir Onboarding de clientes: cerrar tu primera venta dentro del sistema',
      detalle: null,
      origen: 'catalogo',
    },
  ],
};

function fila(over: Partial<TenantAreaRow> & { area_slug: string }): TenantAreaRow {
  return {
    tenant_id: 't',
    state: 'bloqueada',
    label: '',
    icon: 'wrench',
    blurb: '',
    tools: [],
    requirements: [],
    progress: {},
    unlocked_at: null,
    position: 0,
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════

describe('el vocabulario del Ritual no es el del evaluador', () => {
  it('los tres tipos que el agente escribió en producción se traducen', () => {
    expect(traducirRequisito({ type: 'has_pipeline' })).toEqual({ type: 'pipeline_defined' });
    expect(traducirRequisito({ type: 'first_sale' })).toEqual({ type: 'deal_won', min: 1 });
    expect(traducirRequisito({ type: 'declares_hiring' })).toEqual({
      type: 'declared',
      key: 'va_a_contratar',
    });
  });

  it('SIN traducir, el evaluador los rechaza — que es el defecto que esto evita', () => {
    // Ésta es la prueba que justifica el archivo entero: si se copiaran tal cual
    // a `tenant_areas.requirements`, las tres áreas quedarían cerradas para
    // siempre y con el candado diciendo que hay algo que no sabemos leer.
    const crudos = [{ type: 'has_pipeline' }, { type: 'first_sale' }, { type: 'declares_hiring' }];
    const conTodo: Signals = {
      channels_active: 9,
      pipeline_stages: 9,
      values_active: 9,
      documents: 9,
      contacts_active: 9,
      deals_won: 9,
      months_operating: 9,
    };

    const sinTraducir = evaluate(crudos, conTodo);
    expect(sinTraducir.met).toBe(false);

    const traducidos = traducirRequisitos(crudos);
    expect(traducidos).not.toBeNull();
    // Con la traducción, dos de los tres se cumplen solos; el tercero es una
    // declaración, que ninguna señal puede dar por él.
    const conTraduccion = evaluate(traducidos, conTodo, {
      declared: { va_a_contratar: true },
    });
    expect(conTraduccion.met).toBe(true);
  });

  it('los tipos que ya coinciden pasan tal cual, con su `min`', () => {
    expect(traducirRequisito({ type: 'contact_count', min: 5 })).toEqual({
      type: 'contact_count',
      min: 5,
    });
    // `min` ausente significa "al menos uno", igual que en `parseRequirement`.
    expect(traducirRequisito({ type: 'has_channel' })).toEqual({ type: 'has_channel', min: 1 });
  });

  it('un tipo que nadie sabe leer devuelve null, y NO se cumple por omisión', () => {
    expect(traducirRequisito({ type: 'lo_que_sea' })).toBeNull();
    expect(traducirRequisito({ type: 'declared' })).toBeNull(); // sin `key`
    expect(traducirRequisito(null)).toBeNull();
  });

  it('una lista con UNA condición ilegible se descarta entera', () => {
    // Escribir sólo las que se tradujeron aflojaría la puerta: el área abriría
    // con menos condiciones de las que el agente le puso.
    expect(traducirRequisitos([{ type: 'has_channel' }, { type: 'inventado' }])).toBeNull();
    expect(traducirRequisitos([])).toEqual([]);
  });

  it('el `any_of` se traduce por dentro, y una alternativa rota lo invalida', () => {
    expect(
      traducirRequisitos([
        { type: 'any_of', of: [{ type: 'first_sale' }, { type: 'document_count', min: 1 }] },
      ]),
    ).toEqual([
      { type: 'any_of', of: [{ type: 'deal_won', min: 1 }, { type: 'document_count', min: 1 }] },
    ]);

    expect(
      traducirRequisitos([{ type: 'any_of', of: [{ type: 'first_sale' }, { type: 'ufff' }] }]),
    ).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('leer el blueprint que llega de H7', () => {
  it('lee el de producción entero', () => {
    const b = leerBlueprint(BLUEPRINT_DE_PRODUCCION);
    expect(b?.areas.map((a) => a.slug)).toEqual([
      'ventas',
      'servicio',
      'direccion',
      'onboarding',
      'rh',
      'finanzas',
    ]);
    expect(b?.hitos).toHaveLength(2);
    expect(b?.areas[0]?.label).toBe('Ventas y marketing');
    expect(b?.areas[0]?.estado).toBe('en_progreso');
  });

  it('descarta las áreas cuyo slug no puede ser una llave primaria', () => {
    const b = leerBlueprint({
      id: 'x',
      areas: [
        { slug: 'Ventas y marketing', label: 'a' }, // espacios y mayúsculas
        { slug: '', label: 'b' },
        { slug: 'ventas', label: 'c' },
        { slug: 'ventas', label: 'duplicada' },
        { slug: 42, label: 'd' },
      ],
      hitos: [],
    });
    // Sólo la legible, y una sola vez: `(tenant_id, area_slug)` es la PK.
    expect(b?.areas.map((a) => a.slug)).toEqual(['ventas']);
    expect(b?.areas[0]?.label).toBe('c');
  });

  it('un estado inventado cae a `bloqueada`, no abre nada', () => {
    const b = leerBlueprint({ id: 'x', areas: [{ slug: 'rh', estado: 'abierta_total' }], hitos: [] });
    expect(b?.areas[0]?.estado).toBe('bloqueada');
  });

  it('un blueprint sin id no es un blueprint', () => {
    expect(leerBlueprint({ areas: [], hitos: [] })).toBeNull();
    expect(leerBlueprint('nada')).toBeNull();
  });

  it('recorta los títulos largos en vez de dejar que revienten al insertar', () => {
    const b = leerBlueprint({
      id: 'x',
      areas: [],
      hitos: [{ titulo: 'a'.repeat(500), origen: 'emprendedor' }],
    });
    expect(b?.hitos[0]?.titulo).toHaveLength(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('el plan de escritura', () => {
  const b = leerBlueprint(BLUEPRINT_DE_PRODUCCION);

  it('un área que la siembra no creó se INSERTA, con la mecánica del catálogo', () => {
    // `servicio` no está en la plantilla `general` ni es `seed_always`: si el
    // sink no la insertara, el mapa que el agente prometió llegaría incompleto.
    const p = planDeArea(
      b!.areas[1]!,
      undefined,
      { requirements: [{ type: 'contact_count', min: 5 }], tools: ['servicio:resumen'], icon: 'headset' },
      AHORA,
    );

    expect(p.nueva).toBe(true);
    expect(p.patch.area_slug).toBe('servicio');
    expect(p.patch.label).toBe('Servicio y atención');
    expect(p.patch.icon).toBe('headset');
    expect(p.patch.tools).toEqual(['servicio:resumen']);
    expect(p.patch.state).toBe('disponible');
    expect(p.patch.unlocked_at).toBe(AHORA);
  });

  it('las palabras del agente le ganan a las genéricas del catálogo', () => {
    // El catálogo la llama «Ventas»; el Ritual la llamó «Ventas y marketing»
    // porque así se la describió su dueño. Es lo que se le narró al cerrar, y
    // verlo distinto en el panel es su propia mentira pequeña.
    const p = planDeArea(b!.areas[0]!, fila({ area_slug: 'ventas', label: 'Ventas' }), null, AHORA);
    expect(p.nueva).toBe(false);
    expect(p.patch.label).toBe('Ventas y marketing');
    expect(p.patch.position).toBe(1);
  });

  it('EL ESTADO NUNCA RETROCEDE, que es lo que hace segura la reproyección', () => {
    const yaActiva = fila({ area_slug: 'servicio', state: 'activa', unlocked_at: '2026-07-01T00:00:00Z' });
    const p = planDeArea(b!.areas[1]!, yaActiva, null, AHORA);
    // El blueprint dice `disponible`; el área ya estaba `activa`. Se queda.
    expect(p.patch.state).toBeUndefined();
    expect(p.patch.unlocked_at).toBeUndefined();
  });

  it('`unlocked_at` se pone UNA vez: es la fecha en que se lo ganó', () => {
    const abierta = fila({ area_slug: 'rh', state: 'disponible', unlocked_at: '2026-07-01T00:00:00Z' });
    expect(planDeArea(b!.areas[4]!, abierta, null, AHORA).patch.unlocked_at).toBeUndefined();
  });

  it('los requisitos del Ritual se escriben traducidos', () => {
    const p = planDeArea(b!.areas[0]!, fila({ area_slug: 'ventas' }), null, AHORA);
    expect(p.patch.requirements).toEqual([
      { type: 'has_channel', min: 1 },
      { type: 'pipeline_defined' },
    ]);
  });

  it('si NO se entienden, manda el catálogo — nunca se escribe lo ilegible', () => {
    const rara = {
      slug: 'marketing',
      label: 'Marketing',
      estado: 'bloqueada' as const,
      blurb: '',
      position: 7,
      razon: '',
      requisitos: [{ type: 'algo_que_nadie_sabe_leer' }],
    };
    const conCatalogo = planDeArea(
      rara,
      undefined,
      { requirements: [{ type: 'has_channel', min: 1 }], tools: [], icon: 'megaphone' },
      AHORA,
    );
    expect(conCatalogo.patch.requirements).toEqual([{ type: 'has_channel', min: 1 }]);

    // Y sin catálogo tampoco se deja `[]`, que se cumple solo y le regalaría un
    // área que nadie decidió abrirle.
    const sinCatalogo = planDeArea(rara, undefined, null, AHORA);
    expect(sinCatalogo.patch.requirements).toEqual([{ type: 'manual' }]);
  });

  it('a una fila que ya existe no se le tocan los requisitos si no se entienden', () => {
    const existente = fila({
      area_slug: 'marketing',
      requirements: [{ type: 'has_channel', min: 1 }],
    });
    const p = planDeArea(
      { slug: 'marketing', label: 'M', estado: 'bloqueada', blurb: '', position: 7, razon: '', requisitos: [{ type: 'xyz' }] },
      existente,
      null,
      AHORA,
    );
    expect(p.patch.requirements).toBeUndefined();
  });

  it('las áreas que el blueprint NO menciona se quedan como están', () => {
    const filas = [fila({ area_slug: 'operaciones', state: 'activa' })];
    const plan = planDeProyeccion(b!, filas, new Map(), AHORA);
    expect(plan.map((p) => p.slug)).not.toContain('operaciones');
    expect(plan).toHaveLength(6);
  });

  it('reproyectar dos veces sobre el resultado de la primera no cambia el estado', () => {
    const primera = planDeProyeccion(b!, [], new Map(), AHORA);

    // Se simula la base después de la primera pasada.
    const despues = primera.map((p) =>
      fila({
        area_slug: p.slug,
        state: (p.patch.state as TenantAreaRow['state']) ?? 'bloqueada',
        unlocked_at: (p.patch.unlocked_at as string | undefined) ?? null,
        label: String(p.patch.label ?? ''),
        requirements: p.patch.requirements ?? [],
      }),
    );

    const segunda = planDeProyeccion(b!, despues, new Map(), '2026-09-01T00:00:00.000Z');
    for (const p of segunda) {
      expect(p.nueva).toBe(false);
      expect(p.patch.state).toBeUndefined();
      expect(p.patch.unlocked_at).toBeUndefined();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('el roadmap no se duplica', () => {
  const b = leerBlueprint(BLUEPRINT_DE_PRODUCCION)!;

  it('la primera vez entran los dos hitos, con su origen traducido', () => {
    const nuevos = hitosQueFaltan(b, [], 0);
    expect(nuevos).toHaveLength(2);
    // `abogado_del_diablo` es lo que el emprendedor NO pidió y el agente
    // detectó: es del agente, no suyo.
    expect(nuevos[0]?.generated_by).toBe('master_agent');
    expect(nuevos[1]?.generated_by).toBe('seed');
    expect(nuevos[0]?.position).toBe(1);
    expect(nuevos[1]?.position).toBe(2);
  });

  it('la segunda vez no entra ninguno — el barrido llama más de una vez', () => {
    const ya = b.hitos.map((h) => ({ title: h.titulo }));
    expect(hitosQueFaltan(b, ya, 2)).toEqual([]);
  });

  it('compara sin acentos ni mayúsculas: el guardado pasó por un trim, el nuevo no', () => {
    expect(
      hitosQueFaltan(
        { ...b, hitos: [{ areaSlug: null, titulo: 'Definir tu Precio Mínimo', detalle: null, origen: 'emprendedor' }] },
        [{ title: '  definir tu precio minimo ' }],
        0,
      ),
    ).toEqual([]);
  });

  it('los hitos nuevos se ponen DESPUÉS de los que ya tenía', () => {
    const nuevos = hitosQueFaltan(b, [{ title: 'otro' }], 7);
    expect(nuevos[0]?.position).toBe(8);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('lo que ve el emprendedor al final', () => {
  it('con el mapa proyectado y su negocio en cero, Ventas dice qué le falta EN CASTELLANO', () => {
    const b = leerBlueprint(BLUEPRINT_DE_PRODUCCION)!;
    const p = planDeArea(b.areas[0]!, fila({ area_slug: 'ventas' }), null, AHORA);
    const ev = evaluate(p.patch.requirements, SIGNALS_CERO);

    expect(ev.met).toBe(false);
    expect(ev.missing).toEqual(['conectas un canal', 'defines tu embudo de ventas']);
    // Ni un nombre de paquete, ni un número de migración, ni una H con número.
    for (const frase of ev.missing) {
      expect(frase).not.toMatch(/packages\/|migraci|H\d|TODO/i);
    }
  });
});
