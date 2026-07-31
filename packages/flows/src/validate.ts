/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El validador. Dos capas, y la segunda es la que vale.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  1. FORMA (zod): que sea un grafo, que los tipos existan, que los números
 *     sean números. Esto lo atrapa cualquiera.
 *
 *  2. SEMÁNTICA: que el grafo se pueda EJECUTAR. Exactamente un disparador.
 *     Sin ciclos (DFS tricolor sobre todo el grafo). Las dos ramas de cada
 *     condición conectadas. Una sola salida por nodo. Ningún id inventado.
 *     Y —lo que ninguna FK puede— que las etapas, etiquetas y responsables que
 *     el flujo menciona existan de verdad en ESTA empresa.
 *
 *  ── Por qué esta es la pieza que de verdad prueba el asistente ─────────────
 *
 *  Un asistente de IA acierta o no acierta; lo que hace que su propuesta sea
 *  SEGURA es que nada llegue a la base sin pasar por aquí. Por eso las pruebas
 *  de este archivo no le dan flujos bonitos: le dan propuestas malas a
 *  propósito —la que inventa un id, la que trae un ciclo, la que deja una rama
 *  colgando— y verifican que las rechace UNA POR UNA con un mensaje que un
 *  humano pueda leer.
 *
 *  Corre en el servidor ANTES de escribir y también contra lo que edita el
 *  builder a mano: el cliente no es más confiable que el modelo.
 */
import { z } from 'zod';
import { TIPOS_DE_NODO, TIPOS_DE_DISPARADOR, OPERADORES, CANALES_DE_SALIDA } from './types';
import type { FlowDefinition } from './types';
import { esBloqueadaPorSsrf } from './ssrf';

// ════════════════════════════════════════════════════════════════════════════
// 1 · La forma
// ════════════════════════════════════════════════════════════════════════════

const zNodo = z.object({
  id: z.string().min(1).max(60),
  type: z.enum(TIPOS_DE_NODO),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  data: z
    .object({
      label: z.string().max(80).optional(),
      config: z.record(z.unknown()).optional(),
    })
    .default({}),
});

const zArista = z.object({
  id: z.string().max(80).optional(),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.enum(['yes', 'no']).nullish(),
  label: z.string().max(40).optional(),
});

export const zDefinicion = z.object({
  nodes: z.array(zNodo).min(1).max(60),
  edges: z.array(zArista).max(120),
});

/** Lo que devuelve el asistente y lo que acepta `PUT /flows/:id`. */
export const zPropuesta = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  trigger_type: z.enum(
    TIPOS_DE_DISPARADOR as unknown as [string, ...string[]],
  ),
  trigger_config: z.record(z.unknown()).default({}),
  definition: zDefinicion,
  notes: z.string().max(600).nullish(),
});

export type Propuesta = z.infer<typeof zPropuesta>;

// ════════════════════════════════════════════════════════════════════════════
// 2 · La semántica
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lo que existe de verdad en esta empresa. El asistente lo recibe en su prompt
 * y el validador lo usa para rechazar ids inventados.
 *
 * Las listas VACÍAS no invalidan nada: un tenant recién creado no tiene
 * etapas, y rechazar por eso convertiría "todavía no configuras tu embudo" en
 * "tu flujo está mal". Se valida contra el catálogo sólo cuando hay catálogo.
 */
export interface CatalogoDelTenant {
  etapas: Array<{ id: string; slug: string; name: string; pipelineSlug: string }>;
  etiquetas: string[];
  miembros: Array<{ email: string; name: string | null }>;
}

export const CATALOGO_VACIO: CatalogoDelTenant = { etapas: [], etiquetas: [], miembros: [] };

const cfgDe = (n: { data?: { config?: Record<string, unknown> } }): Record<string, unknown> =>
  n.data?.config ?? {};

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

/**
 * Detecta ciclos con DFS tricolor sobre TODO el grafo.
 *
 * El motor tiene un tope de 100 pasos, así que un ciclo no tumba el servidor —
 * pero sí manda 100 mensajes reales a un cliente antes de rendirse, y congela
 * el layout del builder. Se rechaza antes de guardar.
 *
 * Iterativo y no recursivo a propósito: un grafo de 60 nodos en cadena
 * desbordaría la pila en el peor caso, y el peor caso lo escribe un usuario.
 */
export function tieneCiclo(def: FlowDefinition): boolean {
  const salidas = new Map<string, string[]>();
  for (const e of def.edges) {
    salidas.set(e.source, [...(salidas.get(e.source) ?? []), e.target]);
  }

  const BLANCO = 0;
  const GRIS = 1;
  const NEGRO = 2;
  const color = new Map<string, number>();

  for (const raiz of def.nodes) {
    if ((color.get(raiz.id) ?? BLANCO) !== BLANCO) continue;

    // pila de (nodo, índice del hijo por visitar)
    const pila: Array<{ id: string; i: number }> = [{ id: raiz.id, i: 0 }];
    color.set(raiz.id, GRIS);

    while (pila.length > 0) {
      const marco = pila[pila.length - 1];
      if (!marco) break;
      const hijos = salidas.get(marco.id) ?? [];

      if (marco.i >= hijos.length) {
        color.set(marco.id, NEGRO);
        pila.pop();
        continue;
      }

      const hijo = hijos[marco.i];
      marco.i += 1;
      if (hijo === undefined) continue;

      const c = color.get(hijo) ?? BLANCO;
      if (c === GRIS) return true; // arista de retroceso: ciclo
      if (c === BLANCO) {
        color.set(hijo, GRIS);
        pila.push({ id: hijo, i: 0 });
      }
    }
  }
  return false;
}

/** Los nodos a los que no se llega desde el disparador. */
export function nodosHuerfanos(def: FlowDefinition): string[] {
  const trigger = def.nodes.find((n) => n.type === 'trigger');
  if (!trigger) return [];

  const salidas = new Map<string, string[]>();
  for (const e of def.edges) salidas.set(e.source, [...(salidas.get(e.source) ?? []), e.target]);

  const vistos = new Set<string>([trigger.id]);
  const pendientes = [trigger.id];
  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    if (actual === undefined) break;
    for (const h of salidas.get(actual) ?? []) {
      if (!vistos.has(h)) {
        vistos.add(h);
        pendientes.push(h);
      }
    }
  }
  return def.nodes.filter((n) => !vistos.has(n.id)).map((n) => n.id);
}

/**
 * Todo lo que hace que un grafo bien formado siga sin poder ejecutarse.
 *
 * Devuelve mensajes en español dirigidos a un humano, no códigos: los lee el
 * emprendedor en el builder y también el modelo en el re-prompt del asistente.
 * Un error que sólo entiende quien escribió el validador no sirve para
 * ninguno de los dos.
 */
export function validarSemantica(
  p: Propuesta,
  catalogo: CatalogoDelTenant = CATALOGO_VACIO,
): string[] {
  const errs: string[] = [];
  const { nodes, edges } = p.definition;

  // ── Identidad de los nodos ──────────────────────────────────────────────
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) errs.push('hay ids de nodo repetidos');

  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) {
    errs.push(`debe haber exactamente 1 nodo disparador (hay ${triggers.length})`);
  }
  const trigger = triggers[0];

  // ── Aristas ─────────────────────────────────────────────────────────────
  const salidasVistas = new Set<string>();
  for (const e of edges) {
    if (!ids.has(e.source)) errs.push(`una conexión sale de un paso que no existe: "${e.source}"`);
    if (!ids.has(e.target)) errs.push(`una conexión llega a un paso que no existe: "${e.target}"`);
    if (trigger && e.target === trigger.id) errs.push('nada puede conectarse hacia el disparador');
    if (e.source === e.target) errs.push(`el paso "${e.source}" se conecta consigo mismo`);

    // El motor toma UNA salida por handle: dos aristas en la misma salida
    // serían una rama invisible que nunca corre.
    const llave = `${e.source}::${e.sourceHandle ?? ''}`;
    if (salidasVistas.has(llave)) {
      errs.push(
        `el paso "${e.source}" tiene dos conexiones en la misma salida — ` +
          'para bifurcar usa un paso "Si pasa esto…"',
      );
    }
    salidasVistas.add(llave);
  }

  if (tieneCiclo(p.definition)) {
    errs.push(
      'el flujo tiene un ciclo (un camino regresa a un paso anterior) — los flujos van siempre hacia adelante',
    );
  }

  for (const h of nodosHuerfanos(p.definition)) {
    errs.push(`al paso "${h}" no se llega desde el disparador: conéctalo o quítalo`);
  }

  // ── Configuración de cada nodo ──────────────────────────────────────────
  const slugsEtapa = new Set(catalogo.etapas.flatMap((e) => [e.slug, e.id]));
  const correos = new Set(catalogo.miembros.map((m) => m.email.toLowerCase()));

  for (const n of nodes) {
    const cfg = cfgDe(n);
    const salidas = edges.filter((e) => e.source === n.id);

    switch (n.type) {
      case 'send_message': {
        if (!texto(cfg.template)) errs.push(`el paso "${n.id}" (mandar mensaje) no tiene qué decir`);
        const canal = texto(cfg.channel);
        if (!canal) {
          errs.push(`el paso "${n.id}" (mandar mensaje) no dice por qué canal`);
        } else if (!(CANALES_DE_SALIDA as readonly string[]).includes(canal)) {
          errs.push(
            `el paso "${n.id}": el canal "${canal}" no existe (${CANALES_DE_SALIDA.join(', ')})`,
          );
        }
        const para = texto(cfg.to);
        if (para && para !== 'contact' && para !== 'owner' && !para.startsWith('address:')) {
          errs.push(
            `el paso "${n.id}": "para quién" debe ser el contacto, su responsable, o address:<dirección>`,
          );
        }
        break;
      }

      case 'wait': {
        const minutos = Number(cfg.minutes ?? 0);
        if (!Number.isFinite(minutos) || minutos <= 0) {
          errs.push(`el paso "${n.id}" (esperar) necesita un número de minutos mayor que cero`);
        } else if (minutos > 60 * 24 * 90) {
          errs.push(`el paso "${n.id}" (esperar) pide más de 90 días: probablemente es un error`);
        }
        break;
      }

      case 'condition': {
        if (!texto(cfg.field)) errs.push(`el paso "${n.id}" (condición) no dice qué campo mirar`);
        const op = texto(cfg.op) || 'eq';
        if (!(OPERADORES as readonly string[]).includes(op)) {
          errs.push(`el paso "${n.id}" (condición): la comparación "${op}" no existe`);
        }
        if (op !== 'not_empty' && op !== 'empty' && !texto(cfg.value)) {
          errs.push(`el paso "${n.id}" (condición): falta con qué comparar`);
        }
        // Las DOS ramas conectadas. La que no haga nada va a un paso "Terminar".
        if (!salidas.some((e) => e.sourceHandle === 'yes') || !salidas.some((e) => e.sourceHandle === 'no')) {
          errs.push(
            `el paso "${n.id}" (condición): conecta las dos salidas, la de sí y la de no ` +
              '(la que no haga nada va a un paso "Terminar")',
          );
        }
        break;
      }

      case 'assign_owner': {
        const correo = texto(cfg.owner_email);
        const pool = texto(cfg.pool);
        if (!correo && !pool) {
          errs.push(`el paso "${n.id}" (asignar responsable): di a quién, o reparte entre el equipo`);
        }
        if (correo && correos.size > 0 && !correos.has(correo.toLowerCase())) {
          errs.push(
            `el paso "${n.id}": "${correo}" no es de tu equipo — invítalo antes de asignarle contactos`,
          );
        }
        break;
      }

      case 'move_stage': {
        const etapa = texto(cfg.stage);
        if (!etapa) {
          errs.push(`el paso "${n.id}" (mover de etapa) no dice a cuál`);
        } else if (slugsEtapa.size > 0 && !slugsEtapa.has(etapa)) {
          errs.push(
            `el paso "${n.id}": la etapa "${etapa}" no existe en tu embudo ` +
              `(las tuyas: ${catalogo.etapas.map((e) => e.slug).join(', ')})`,
          );
        }
        break;
      }

      case 'add_tag':
        if (!texto(cfg.tag)) errs.push(`el paso "${n.id}" (poner etiqueta) no dice cuál`);
        break;

      case 'create_task':
        if (!texto(cfg.title)) errs.push(`el paso "${n.id}" (crear tarea) no tiene título`);
        break;

      case 'webhook': {
        const url = texto(cfg.url);
        if (!/^https?:\/\//i.test(url)) {
          errs.push(`el paso "${n.id}" (llamar a otro sistema): la URL debe empezar con http o https`);
        } else if (esBloqueadaPorSsrf(url)) {
          // Se rechaza AL GUARDAR y no sólo al ejecutar: un flujo que apunta a
          // una dirección interna es un flujo que nunca va a correr, y
          // enterarse tres días después —cuando entre el lead— es tarde.
          errs.push(
            `el paso "${n.id}": esa dirección es interna o privada y está bloqueada. ` +
              'El webhook tiene que apuntar a una URL pública tuya.',
          );
        }
        const metodo = (texto(cfg.method) || 'POST').toUpperCase();
        if (!['GET', 'POST', 'PUT'].includes(metodo)) {
          errs.push(`el paso "${n.id}": el método "${metodo}" no está permitido (GET, POST o PUT)`);
        }
        break;
      }

      case 'ai_step':
        if (!texto(cfg.prompt)) errs.push(`el paso "${n.id}" (preguntarle a un agente) no tiene instrucción`);
        break;

      case 'trigger':
      case 'end':
        break;
    }

    // Un nodo que no termina y no tiene salida deja la corrida colgada sin
    // decirlo. Se permite —el motor la cierra como completada— pero se avisa
    // sólo cuando es claramente un olvido: el nodo bifurca y no conecta nada.
    if (n.type === 'condition' && salidas.length === 0) {
      errs.push(`el paso "${n.id}" (condición) no lleva a ningún lado`);
    }
  }

  // ── Filtros del disparador ──────────────────────────────────────────────
  const tc = p.trigger_config;
  if (p.trigger_type === 'stage_changed') {
    const etapa = texto(tc.stage);
    if (etapa && slugsEtapa.size > 0 && !slugsEtapa.has(etapa)) {
      errs.push(`el disparador filtra por la etapa "${etapa}", que no existe en tu embudo`);
    }
  }

  return errs;
}

// ════════════════════════════════════════════════════════════════════════════
// La puerta única
// ════════════════════════════════════════════════════════════════════════════

export interface ResultadoValidacion {
  ok: boolean;
  errores: string[];
  propuesta?: Propuesta;
}

/**
 * Forma + semántica en una llamada. Es por donde pasa TODO lo que se guarda:
 * la propuesta del asistente y la edición a mano del builder.
 */
export function validar(
  crudo: unknown,
  catalogo: CatalogoDelTenant = CATALOGO_VACIO,
): ResultadoValidacion {
  const forma = zPropuesta.safeParse(crudo);
  if (!forma.success) {
    return {
      ok: false,
      errores: forma.error.issues.map((i) => {
        const donde = i.path.join('.');
        return donde ? `${donde}: ${i.message}` : i.message;
      }),
    };
  }
  const errores = validarSemantica(forma.data, catalogo);
  return errores.length > 0
    ? { ok: false, errores, propuesta: forma.data }
    : { ok: true, errores: [], propuesta: forma.data };
}
