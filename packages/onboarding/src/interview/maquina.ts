/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La máquina de estados. Una función pura.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Entra: en qué fase va, qué se sabe del negocio y lo que acaba de contestar
 *  el modelo. Sale: qué se sabe ahora, en qué fase queda y qué se le enseña.
 *
 *  Sin base de datos, sin red, sin reloj propio. Eso es lo que permite probar
 *  los criterios #5, #6 y #8 del handoff sin una Supabase viva y sin gastar un
 *  token — y por lo tanto probarlos en CI, en cada PR, en vez de "cuando se
 *  pueda".
 *
 *  La regla de oro: `[FASE_COMPLETA:x]` es una PETICIÓN. Quien decide es
 *  `puedeCerrar()`. Ver cierre.ts.
 */
import type { AreaState } from '@abraxa/db';
import type { Dolor, EstadoNegocio, Fase, Hito, PasoDelProceso } from '../types';
import { puedeCerrar } from './cierre';
import { siguienteFase } from './fases';
import { leerMarcadores, limpiarMarcadores } from './marcadores';

export interface ResultadoDelTurno {
  /** El estado del negocio, ya con lo que salió de este turno. */
  estado: EstadoNegocio;
  /** La fase en la que queda. Puede ser la misma. */
  fase: Fase;
  /** Lo que ve el emprendedor. Sin un solo marcador. */
  visible: string;
  /** `true` si este turno cerró una fase de verdad. */
  avanzo: boolean;
  /**
   * El modelo pidió cerrar y no se le concedió porque faltaban datos.
   *
   * No es un error: es el caso normal de un agente entusiasta. Se expone
   * porque el guion de la siguiente vuelta lo usa para insistir con lo que
   * falta, en vez de dejar al modelo adivinando por qué no avanzó.
   */
  cierreDenegado: boolean;
  pausa: boolean;
  mapaListo: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// Cómo aterriza cada `[DATO:clave=valor]`
// ════════════════════════════════════════════════════════════════════════════

/**
 * Claves de `[DATO:…]` → campo del estado.
 *
 * Se aceptan alias (`modelo_ingreso` y `modeloIngreso`) porque el modelo no es
 * consistente entre turnos y perder el ticket promedio por un guion bajo sería
 * ridículo. Lo que NO está en esta tabla cae en `extra`: se guarda igual, no se
 * tira. Un dato del negocio que el agente consideró importante no se descarta
 * porque no teníamos columna.
 */
const CAMPOS: Record<string, keyof EstadoNegocio> = {
  agente: 'agente',
  nombre_agente: 'agente',
  nombreAgente: 'agente',
  giro: 'giro',
  nicho: 'nicho',
  etapa: 'etapa',
  tamano: 'tamano',
  tamaño: 'tamano',
  modelo_ingreso: 'modeloIngreso',
  modeloIngreso: 'modeloIngreso',
  ticket: 'ticket',
  margen: 'margen',
  equipo: 'equipo',
  equipo_detalle: 'equipoDetalle',
  equipoDetalle: 'equipoDetalle',
};

/** Claves de `[LISTA:…]` → campo de arreglo. */
const LISTAS: Record<string, 'canales' | 'herramientas'> = {
  canales: 'canales',
  canal: 'canales',
  herramientas: 'herramientas',
  herramienta: 'herramientas',
};

const ESTADOS_DE_AREA = new Set<string>(['bloqueada', 'disponible', 'en_progreso', 'activa']);

/** Une sin duplicar, comparando sin acentos ni mayúsculas. */
function unir(previo: string[] | undefined, nuevos: string[]): string[] {
  const salida = [...(previo ?? [])];
  const vistos = new Set(salida.map(normalizar));
  for (const n of nuevos) {
    const k = normalizar(n);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    salida.push(n);
  }
  return salida;
}

function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ════════════════════════════════════════════════════════════════════════════
// El turno
// ════════════════════════════════════════════════════════════════════════════

/**
 * Aplica una respuesta del modelo al estado del Ritual.
 *
 * @param fase   fase en curso
 * @param previo lo que ya se sabía del negocio
 * @param cruda  la respuesta del modelo, con marcadores
 */
export function aplicarTurno(fase: Fase, previo: EstadoNegocio, cruda: string): ResultadoDelTurno {
  const s = leerMarcadores(cruda);
  const estado: EstadoNegocio = { ...previo };

  // ── Campos simples ────────────────────────────────────────────────────────
  for (const [clave, valor] of Object.entries(s.datos)) {
    const campo = CAMPOS[clave];
    if (campo) {
      // Todos los campos mapeados son `string` en EstadoNegocio; el cast es la
      // forma de decírselo al compilador sin abrir el tipo entero.
      (estado as Record<string, unknown>)[campo] = valor;
    } else {
      estado.extra = { ...(estado.extra ?? {}), [clave]: valor };
    }
  }

  // ── Listas ────────────────────────────────────────────────────────────────
  for (const [clave, valores] of Object.entries(s.listas)) {
    const campo = LISTAS[clave];
    if (campo) {
      estado[campo] = unir(estado[campo], valores);
    } else {
      estado.extra = { ...(estado.extra ?? {}), [clave]: valores.join(', ') };
    }
  }

  // ── El recorrido del cliente ──────────────────────────────────────────────
  // Se acumula en el ORDEN en que lo contó, y un paso repetido no se duplica:
  // se enriquece. El modelo suele mencionar "cotización" primero a secas y
  // después decir con qué la hace.
  if (s.pasos.length > 0) {
    const recorrido: PasoDelProceso[] = [...(estado.recorrido ?? [])];
    for (const p of s.pasos) {
      const i = recorrido.findIndex((x) => normalizar(x.nombre) === normalizar(p.nombre));
      if (i === -1) {
        recorrido.push(p.como ? { nombre: p.nombre, como: p.como } : { nombre: p.nombre });
      } else if (p.como) {
        recorrido[i] = { ...recorrido[i]!, como: p.como };
      }
    }
    estado.recorrido = recorrido;
  }

  // ── Dolores ───────────────────────────────────────────────────────────────
  if (s.dolores.length > 0) {
    const dolores: Dolor[] = [...(estado.dolores ?? [])];
    for (const d of s.dolores) {
      if (dolores.some((x) => normalizar(x.texto) === normalizar(d.texto))) continue;
      dolores.push(d.areaSlug ? { texto: d.texto, areaSlug: d.areaSlug } : { texto: d.texto });
    }
    estado.dolores = dolores;
  }

  // ── Hitos ─────────────────────────────────────────────────────────────────
  //
  // El origen por defecto sale de la fase: lo que nace en la fase 4 lo detectó
  // el agente atacando el proceso, no lo pidió el emprendedor. Es lo que hace
  // verificable el criterio #8, y por eso se decide aquí y no se le deja al
  // modelo — que diría "emprendedor" para todo con tal de sonar respetuoso.
  if (s.hitos.length > 0) {
    const hitos: Hito[] = [...(estado.hitos ?? [])];
    for (const h of s.hitos) {
      if (hitos.some((x) => normalizar(x.titulo) === normalizar(h.titulo))) continue;
      const origen: Hito['origen'] =
        h.origen === 'emprendedor'
          ? 'emprendedor'
          : fase === 'dolor'
            ? 'abogado_del_diablo'
            : 'emprendedor';
      hitos.push({
        areaSlug: h.areaSlug,
        titulo: h.titulo,
        ...(h.detalle ? { detalle: h.detalle } : {}),
        origen,
      });
    }
    estado.hitos = hitos;
  }

  // ── Áreas propuestas en la conversación ───────────────────────────────────
  if (s.areas.length > 0) {
    const propuestas = [...(estado.areasPropuestas ?? [])];
    for (const a of s.areas) {
      if (!ESTADOS_DE_AREA.has(a.estado)) continue;
      const i = propuestas.findIndex((x) => x.slug === a.slug);
      const propuesta = {
        slug: a.slug,
        estado: a.estado as AreaState,
        ...(a.razon ? { razon: a.razon } : {}),
      };
      if (i === -1) propuestas.push(propuesta);
      else propuestas[i] = propuesta;
    }
    estado.areasPropuestas = propuestas;
  }

  // ── La transición ─────────────────────────────────────────────────────────
  //
  // Decide `puedeCerrar()`. Y SÓLO `puedeCerrar()`.
  //
  // Hasta el 2026-07-31 esto exigía además que el modelo emitiera
  // `[FASE_COMPLETA:x]`, y con eso el Ritual no llegaba nunca al Mapa de
  // Negocio. Medido en vivo: la fase 'bienvenida' —que pide UN dato, el nombre
  // del agente— duró 10 turnos con el agente ya bautizado y sin nada
  // pendiente; 'proceso' se atoró otros 6 con el recorrido completo. Sólo
  // avanzaba cuando el entrevistado escribía «Sigamos», que no es una función
  // del producto.
  //
  // La causa no era el prompt: se probó con el system EXACTO del sistema
  // —incluido el bloque «--- ESTA FASE YA TIENE TODO --- … emite
  // [FASE_COMPLETA:proceso]»— contra tres modelos. claude-sonnet-4.5 emitió
  // CERO marcadores de fase; claude-haiku-4.5, cero; gpt-4.1 sí. La familia
  // Claude es justo la que está configurada por defecto para el rol `master`.
  //
  // Así que la regla de oro se cumple ahora de verdad: el marcador es una
  // PETICIÓN —se sigue leyendo, y pedirlo sin datos sigue siendo un cierre
  // denegado que el guion le reclama— pero quien decide es esta función, que
  // verifica los requisitos de `cierre.ts` uno por uno. No se pierde un ápice
  // de rigor: se pierde la dependencia de que un modelo se acuerde de escribir
  // un corchete.
  //
  // La petición tampoco elige destino: la única transición posible es a la
  // fase inmediatamente siguiente. Un modelo que pide cerrar otra fase no
  // salta a ninguna parte.
  const pidioCerrar = s.faseCompleta === fase;
  const puede = puedeCerrar(fase, estado);
  const siguiente = siguienteFase(fase);
  const avanzo = puede && siguiente !== null;

  return {
    estado,
    fase: avanzo && siguiente ? siguiente : fase,
    visible: limpiarMarcadores(cruda),
    avanzo,
    cierreDenegado: pidioCerrar && !puede,
    pausa: s.pausa,
    mapaListo: s.mapaListo,
  };
}
