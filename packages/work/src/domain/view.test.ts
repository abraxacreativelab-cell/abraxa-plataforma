import { describe, expect, it } from 'vitest';
import { tarea, vistaGuardada } from '../testing/factories';
import {
  DEFAULT_GROUP_BY,
  VIEW_KINDS,
  applyFilterRule,
  applyView,
  configFromParam,
  configToParam,
  countActiveFilters,
  isQuickFilterOn,
  localDate,
  locationFromParams,
  locationToParams,
  matchesFilter,
  normalizeViewConfig,
  normalizeViewKind,
  presetFor,
  quickFilters,
  toggleQuickFilter,
  type FilterGroup,
  type ViewConfig,
} from './view';

const AHORA = new Date(2026, 6, 31, 9, 0, 0); // 31-jul-2026, hora local

describe('las cuatro vistas', () => {
  it('son exactamente cuatro y ninguna es de las que el handoff manda no portar', () => {
    expect(VIEW_KINDS).toEqual(['proyecto', 'responsable', 'calendario', 'progreso']);
    expect(VIEW_KINDS).not.toContain('timeline');
    expect(VIEW_KINDS).not.toContain('gallery');
  });

  it('cada una abre agrupada por lo que responde su pregunta', () => {
    expect(DEFAULT_GROUP_BY.proyecto).toBe('project_id');
    expect(DEFAULT_GROUP_BY.responsable).toBe('assigned_to');
    expect(DEFAULT_GROUP_BY.progreso).toBe('status');
  });

  it('cada preset arranca mostrando sólo lo que falta por hacer', () => {
    for (const kind of VIEW_KINDS) {
      const config = presetFor(kind);
      const cerrada = tarea({ status: 'completed' });
      const abierta = tarea({ status: 'pending' });
      expect(applyView([cerrada, abierta], config, AHORA)).toEqual([abierta]);
    }
  });

  it('los presets no comparten estado entre llamadas', () => {
    const a = presetFor('progreso');
    a.props.push('tags');
    expect(presetFor('progreso').props).not.toContain('tags');
  });
});

describe('normalizeViewConfig', () => {
  it('descarta condiciones y propiedades que el evaluador no conoce', () => {
    const config = normalizeViewConfig({
      filters: {
        op: 'and',
        rules: [
          { prop: 'status', cond: 'is', value: 'pending' },
          { prop: 'company_id', cond: 'is', value: 'inperio' }, // ya no existe
          { prop: 'status', cond: 'regex', value: '.*' }, // inventada
        ],
      },
    });
    expect(config.filters.rules).toEqual([{ prop: 'status', cond: 'is', value: 'pending' }]);
  });

  it('corta la anidación al segundo nivel en vez de rechazar la configuración', () => {
    const config = normalizeViewConfig({
      filters: {
        op: 'and',
        rules: [
          {
            op: 'or',
            rules: [
              { prop: 'priority', cond: 'is', value: 'alta' },
              { op: 'and', rules: [{ prop: 'status', cond: 'is', value: 'blocked' }] },
            ],
          },
        ],
      },
    });
    const nivel1 = config.filters.rules[0] as FilterGroup;
    expect(nivel1.op).toBe('or');
    // La regla del segundo nivel sobrevive; el grupo de tercer nivel se cae.
    expect(nivel1.rules).toEqual([{ prop: 'priority', cond: 'is', value: 'alta' }]);
  });

  it('respeta groupBy: null como una elección y no lo confunde con "ausente"', () => {
    expect(normalizeViewConfig({ groupBy: null }, 'progreso').groupBy).toBeNull();
    expect(normalizeViewConfig({}, 'progreso').groupBy).toBe('status');
  });

  it('devuelve el preset de la vista cuando le dan basura', () => {
    expect(normalizeViewConfig(null, 'calendario')).toEqual(presetFor('calendario'));
    expect(normalizeViewConfig('nada', 'proyecto')).toEqual(presetFor('proyecto'));
  });

  it('normalizeViewKind cae en progreso ante cualquier cosa rara', () => {
    expect(normalizeViewKind('calendario')).toBe('calendario');
    expect(normalizeViewKind('timeline')).toBe('progreso');
    expect(normalizeViewKind(undefined)).toBe('progreso');
  });
});

describe('las diez condiciones', () => {
  const t = tarea({
    status: 'pending',
    priority: 'alta',
    assigned_to: 'ana@ejemplo.mx',
    due_date: '2026-08-02',
    title: 'Cotización para Panadería',
    tags: ['ventas', 'urgente'],
  });

  it('is / is_not comparan el valor exacto', () => {
    expect(applyFilterRule(t, { prop: 'status', cond: 'is', value: 'pending' })).toBe(true);
    expect(applyFilterRule(t, { prop: 'status', cond: 'is_not', value: 'pending' })).toBe(false);
    expect(applyFilterRule(t, { prop: 'status', cond: 'is_not', value: 'blocked' })).toBe(true);
  });

  it('is_any acepta una lista', () => {
    expect(applyFilterRule(t, { prop: 'priority', cond: 'is_any', value: ['critica', 'alta'] })).toBe(true);
    expect(applyFilterRule(t, { prop: 'priority', cond: 'is_any', value: ['baja'] })).toBe(false);
  });

  it('is_empty distingue nulo, cadena vacía y arreglo vacío', () => {
    expect(applyFilterRule(tarea({ assigned_to: null }), { prop: 'assigned_to', cond: 'is_empty' })).toBe(true);
    expect(applyFilterRule(tarea({ tags: [] }), { prop: 'tags', cond: 'is_empty' })).toBe(true);
    expect(applyFilterRule(t, { prop: 'assigned_to', cond: 'is_not_empty' })).toBe(true);
  });

  it('contains busca sin acentos-sensibilidad de mayúsculas en texto y por elemento en listas', () => {
    expect(applyFilterRule(t, { prop: 'title', cond: 'contains', value: 'PANADERÍA' })).toBe(true);
    expect(applyFilterRule(t, { prop: 'tags', cond: 'contains', value: 'urgente' })).toBe(true);
    expect(applyFilterRule(t, { prop: 'tags', cond: 'contains', value: 'compras' })).toBe(false);
  });

  it('before / after / on comparan fechas', () => {
    expect(applyFilterRule(t, { prop: 'due_date', cond: 'before', value: '2026-08-03' })).toBe(true);
    expect(applyFilterRule(t, { prop: 'due_date', cond: 'after', value: '2026-08-03' })).toBe(false);
    expect(applyFilterRule(t, { prop: 'due_date', cond: 'on', value: '2026-08-02' })).toBe(true);
  });

  it('next_n_days usa el día LOCAL y no el de UTC', () => {
    // A las 21:00 en México, UTC ya está en el día siguiente. Una tarea que
    // vence HOY tiene que seguir contando como "hoy".
    const nocheEnMexico = new Date(2026, 6, 31, 21, 30, 0);
    expect(localDate(nocheEnMexico)).toBe('2026-07-31');
    const hoy = tarea({ due_date: '2026-07-31' });
    expect(applyFilterRule(hoy, { prop: 'due_date', cond: 'next_n_days', value: 0 }, nocheEnMexico)).toBe(true);
  });

  it('next_n_days no cuenta lo ya vencido', () => {
    const vencida = tarea({ due_date: '2026-07-01' });
    expect(applyFilterRule(vencida, { prop: 'due_date', cond: 'next_n_days', value: 7 }, AHORA)).toBe(false);
  });
});

describe('grupos AND / OR', () => {
  const t = tarea({ status: 'blocked', priority: 'baja', assigned_to: null });

  it('and exige todas', () => {
    const g: FilterGroup = {
      op: 'and',
      rules: [
        { prop: 'status', cond: 'is', value: 'blocked' },
        { prop: 'priority', cond: 'is', value: 'alta' },
      ],
    };
    expect(matchesFilter(t, g)).toBe(false);
  });

  it('or basta con una', () => {
    const g: FilterGroup = {
      op: 'or',
      rules: [
        { prop: 'status', cond: 'is', value: 'blocked' },
        { prop: 'priority', cond: 'is', value: 'alta' },
      ],
    };
    expect(matchesFilter(t, g)).toBe(true);
  });

  it('un grupo vacío no filtra nada', () => {
    expect(matchesFilter(t, { op: 'and', rules: [] })).toBe(true);
  });

  it('una regla APAGADA se descarta en vez de contar como verdadera dentro de un OR', () => {
    // El error sutil: si una regla apagada devolviera `true`, este OR
    // dejaría pasar TODO en vez de filtrar por la regla que sigue encendida.
    const g: FilterGroup = {
      op: 'or',
      rules: [
        { prop: 'status', cond: 'is', value: 'completed', off: true },
        { prop: 'priority', cond: 'is', value: 'alta' },
      ],
    };
    expect(matchesFilter(t, g)).toBe(false);
  });

  it('un grupo entero apagado no filtra', () => {
    const g: FilterGroup = {
      op: 'and',
      rules: [{ prop: 'status', cond: 'is', value: 'completed' }],
      off: true,
    };
    expect(matchesFilter(t, g)).toBe(true);
  });

  it('anida dos niveles: abiertas Y (urgentes O sin responsable)', () => {
    const g: FilterGroup = {
      op: 'and',
      rules: [
        { prop: 'status', cond: 'is_any', value: ['pending', 'in_progress', 'blocked'] },
        {
          op: 'or',
          rules: [
            { prop: 'priority', cond: 'is_any', value: ['critica', 'alta'] },
            { prop: 'assigned_to', cond: 'is_empty' },
          ],
        },
      ],
    };
    expect(matchesFilter(t, g)).toBe(true);
    expect(matchesFilter(tarea({ status: 'pending', priority: 'baja', assigned_to: 'ana@x.mx' }), g)).toBe(false);
  });
});

describe('applyView', () => {
  const base: ViewConfig = { ...presetFor('progreso'), filters: { op: 'and', rules: [] } };

  it('la búsqueda alcanza título, descripción y etiquetas', () => {
    const porTitulo = tarea({ title: 'Cotización' });
    const porDescripcion = tarea({ description: 'mandar cotización el lunes' });
    const porEtiqueta = tarea({ tags: ['cotizacion'] });
    const otra = tarea({ title: 'Comprar café' });
    const salida = applyView([porTitulo, porDescripcion, porEtiqueta, otra], { ...base, search: 'cotiza' });
    expect(salida).toHaveLength(3);
    expect(salida).not.toContain(otra);
  });

  it('ordena por prioridad de verdad y no alfabéticamente', () => {
    // Alfabéticamente sería alta, baja, crítica, media. Por rango: crítica primero.
    const t = [
      tarea({ id: 'a', priority: 'media' }),
      tarea({ id: 'b', priority: 'critica' }),
      tarea({ id: 'c', priority: 'baja' }),
      tarea({ id: 'd', priority: 'alta' }),
    ];
    const salida = applyView(t, { ...base, sorts: [{ prop: 'priority', dir: 'asc' }] });
    expect(salida.map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('deja los nulos al final aunque el orden sea descendente', () => {
    const t = [
      tarea({ id: 'sin', due_date: null }),
      tarea({ id: 'con', due_date: '2026-08-01' }),
    ];
    expect(applyView(t, { ...base, sorts: [{ prop: 'due_date', dir: 'desc' }] }).map((x) => x.id)).toEqual([
      'con',
      'sin',
    ]);
  });

  it('desempata por sort_order, que es lo que el usuario arrastró', () => {
    const t = [tarea({ id: 'a', sort_order: 2 }), tarea({ id: 'b', sort_order: 1 })];
    expect(applyView(t, base).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('es estable: dos corridas seguidas dan el mismo orden', () => {
    const t = [tarea({ id: 'a' }), tarea({ id: 'b' }), tarea({ id: 'c' })];
    expect(applyView(t, base).map((x) => x.id)).toEqual(applyView(t, base).map((x) => x.id));
  });

  it('no muta el arreglo que recibe', () => {
    const t = [tarea({ id: 'a', sort_order: 2 }), tarea({ id: 'b', sort_order: 1 })];
    applyView(t, base);
    expect(t.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('filtros rápidos', () => {
  it('"Mías" sólo aparece cuando se sabe quién mira', () => {
    expect(quickFilters(null).map((q) => q.id)).not.toContain('mias');
    expect(quickFilters('lupita@ejemplo.mx').map((q) => q.id)).toContain('mias');
  });

  it('apagar conserva la regla para poder volver a prenderla de un clic', () => {
    const urgentes = quickFilters(null).find((q) => q.id === 'urgentes');
    if (!urgentes) throw new Error('falta el filtro rápido de urgentes');

    let config: ViewConfig = { ...presetFor('progreso'), filters: { op: 'and', rules: [] } };

    config = toggleQuickFilter(config, urgentes);
    expect(isQuickFilterOn(config, urgentes)).toBe(true);
    expect(countActiveFilters(config.filters)).toBe(1);

    config = toggleQuickFilter(config, urgentes);
    expect(isQuickFilterOn(config, urgentes)).toBe(false);
    // La regla sigue ahí, apagada — por eso hay 1 regla pero 0 activas.
    expect(config.filters.rules).toHaveLength(1);
    expect(countActiveFilters(config.filters)).toBe(0);

    config = toggleQuickFilter(config, urgentes);
    expect(isQuickFilterOn(config, urgentes)).toBe(true);
    expect(config.filters.rules).toHaveLength(1);
  });

  it('countActiveFilters cuenta los anidados y descuenta los apagados', () => {
    const g: FilterGroup = {
      op: 'and',
      rules: [
        { prop: 'status', cond: 'is', value: 'pending' },
        { prop: 'priority', cond: 'is', value: 'alta', off: true },
        {
          op: 'or',
          rules: [
            { prop: 'assigned_to', cond: 'is_empty' },
            { prop: 'due_date', cond: 'is_not_empty' },
          ],
        },
      ],
    };
    expect(countActiveFilters(g)).toBe(3);
  });
});

describe('enlace profundo — criterio 2', () => {
  it('la configuración sobrevive el viaje de ida y vuelta por la URL', () => {
    const config: ViewConfig = {
      ...presetFor('calendario'),
      search: 'cotización',
      groupBy: 'assigned_to',
      sorts: [{ prop: 'due_date', dir: 'asc' }],
      filters: {
        op: 'and',
        rules: [
          { prop: 'status', cond: 'is_any', value: ['pending'] },
          { op: 'or', rules: [{ prop: 'priority', cond: 'is', value: 'alta' }] },
        ],
      },
    };
    expect(configFromParam(configToParam(config), 'calendario')).toEqual(config);
  });

  it('un enlace roto abre la vista por defecto en vez de una pantalla en blanco', () => {
    expect(configFromParam('{{{no es json', 'progreso')).toBeNull();
    expect(configFromParam(null)).toBeNull();
    expect(configFromParam('')).toBeNull();
  });

  it('una URL en el preset se mantiene corta y no arrastra el JSON', () => {
    const params = locationToParams({ kind: 'progreso', config: presetFor('progreso') });
    expect(params.get('v')).toBe('progreso');
    expect(params.get('c')).toBeNull();
  });

  it('abrir la URL de una vista filtrada en otra pestaña muestra lo mismo', () => {
    const config: ViewConfig = {
      ...presetFor('proyecto'),
      search: 'panadería',
      filters: { op: 'and', rules: [{ prop: 'priority', cond: 'is_any', value: ['critica'] }] },
    };
    const url = locationToParams({ kind: 'proyecto', config, taskId: 'tarea-7' }).toString();

    const otraPestana = locationFromParams(new URLSearchParams(url));
    expect(otraPestana.kind).toBe('proyecto');
    expect(otraPestana.config).toEqual(config);
    expect(otraPestana.taskId).toBe('tarea-7');
  });

  it('lo que dice la URL gana sobre la vista guardada que nombra', () => {
    // Afinar los filtros de una vista guardada y mandar el enlace tiene que
    // mandar los ajustes, no la vista original.
    const guardada = vistaGuardada({ id: 'v1', kind: 'progreso', config: presetFor('progreso') });
    const afinada: ViewConfig = { ...presetFor('progreso'), search: 'lo que yo cambié' };

    const loc = locationFromParams(
      new URLSearchParams(locationToParams({ kind: 'progreso', config: afinada, savedId: 'v1' })),
      [guardada],
    );
    expect(loc.savedId).toBe('v1');
    expect(loc.config.search).toBe('lo que yo cambié');
  });

  it('sin configuración en la URL, la vista guardada manda', () => {
    const guardada = vistaGuardada({
      id: 'v2',
      kind: 'calendario',
      config: { ...presetFor('calendario'), search: 'de la vista' },
    });
    const loc = locationFromParams(new URLSearchParams('s=v2'), [guardada]);
    expect(loc.kind).toBe('calendario');
    expect(loc.config.search).toBe('de la vista');
  });

  it('acepta también el objeto de searchParams de Next', () => {
    const loc = locationFromParams({ v: 'responsable', t: ['tarea-3'] });
    expect(loc.kind).toBe('responsable');
    expect(loc.taskId).toBe('tarea-3');
  });

  it('un enlace a una vista guardada que ya no existe no rompe nada', () => {
    const loc = locationFromParams(new URLSearchParams('v=progreso&s=borrada'), []);
    expect(loc.savedId).toBeNull();
    expect(loc.config).toEqual(presetFor('progreso'));
  });
});
