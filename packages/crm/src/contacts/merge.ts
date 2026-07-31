/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Fusión de duplicados
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  GARDEN no tiene esto. Su deduplicación es preventiva y sólo en la
 *  importación de CSV (`contacts/service.ts:243-254`): arma dos `Set` en
 *  memoria con TODOS los teléfonos y correos del tenant y descarta lo que
 *  coincida. Un duplicado que entra por otro camino —dos webhooks, un
 *  formulario, el alta a mano— se queda para siempre. No hay una sola función
 *  que junte dos contactos existentes en todo el repo.
 *
 *  Aquí sí, y con dos decisiones que valen más que el código:
 *
 *  ── 1. Fusionar NO BORRA ───────────────────────────────────────────────────
 *
 *  El perdedor queda con `merged_into` apuntando al ganador. Borrarlo rompería
 *  `app.threads.contact_id` (H6), los enrolamientos de H8 que lo mencionan y
 *  cualquier reporte histórico. Y sobre todo: una fusión mal hecha sería
 *  irreversible. Así, deshacerla es poner `merged_into = NULL` y devolver lo
 *  movido — la bitácora de `app.contact_merges` guarda qué se movió.
 *
 *  ── 2. Fusionar PROPONE, no adivina ────────────────────────────────────────
 *
 *  `findDuplicates()` NO fusiona nada. Devuelve pares con una razón legible y
 *  un puntaje. Un CRM que junta contactos solo, con un heurístico, es un CRM
 *  que un día junta a dos clientes distintos que comparten el correo de su
 *  empresa — y eso se descubre cuando uno recibe la cotización del otro.
 */
import { PlatformError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import type { FilaContacto, FilaEtiqueta, FilaIdentidad, FilaPosicion } from '../types';
import { aNumero, ahora, db, esDuplicado, fallo, lista, sinAcentos } from '../store';
import { colaTelefonica } from '../identity';
import { registrarEvento } from '../timeline/service';
import { seguirFusion } from './service';

/**
 * Junta dos contactos en uno.
 *
 * ── Orden de las operaciones ───────────────────────────────────────────────
 *
 * No hay transacción: PostgREST no las expone y meter una función de Postgres
 * sólo para esto agregaría un objeto de base que nadie más usa. El orden está
 * elegido para que una interrupción a media fusión deje un estado RECUPERABLE
 * y nunca uno que pierda datos:
 *
 *   1. mover identidades   ← si se corta aquí, el perdedor sigue vivo y
 *                             visible, con menos identidades. Reintentar
 *                             termina el trabajo (todo es idempotente).
 *   2. mover etiquetas
 *   3. mover posiciones de embudo
 *   4. mover línea de tiempo
 *   5. bitácora en contact_merges
 *   6. marcar merged_into  ← ÚLTIMO. Es lo que lo saca de la lista. Hasta que
 *                             esta línea corre, el emprendedor sigue viendo
 *                             las dos tarjetas — que es la verdad.
 *
 * Marcar `merged_into` primero sería el error clásico: el perdedor desaparece
 * de la UI y si algo falla en el paso 3, sus datos quedan en una tarjeta que
 * nadie puede ver.
 */
export async function fusionar(
  ctx: TenantContext,
  i: { winnerId: string; loserId: string; actor?: string },
): Promise<{ winnerId: string; movedIdentities: number; movedEvents: number }> {
  if (i.winnerId === i.loserId) {
    throw new PlatformError('VALIDATION', 'No se puede fusionar un contacto consigo mismo');
  }

  // Si alguno ya venía fusionado, se trabaja sobre los supervivientes. Sin
  // esto, fusionar hacia una tarjeta muerta crea una cadena innecesaria.
  const winnerId = await seguirFusion(ctx, i.winnerId);
  const loserId = await seguirFusion(ctx, i.loserId);

  if (winnerId === loserId) {
    throw new PlatformError(
      'VALIDATION',
      'Esos dos contactos ya son el mismo: uno se fusionó en el otro antes.',
    );
  }

  const [ganador, perdedor] = await Promise.all([
    leerFila(ctx, winnerId),
    leerFila(ctx, loserId),
  ]);

  // ── 1. Identidades ───────────────────────────────────────────────────────
  const identidades = lista(
    await db(ctx).from('contact_identities').select('*').eq('contact_id', loserId),
    'identidades del perdedor',
  ) as unknown as FilaIdentidad[];

  let movidas = 0;
  for (const ident of identidades) {
    /* `is_primary` se apaga al mover: el ganador ya tiene la suya en ese canal
       y el índice único parcial `(tenant_id, contact_id, channel) WHERE
       is_primary` rechazaría la segunda. Quién es la principal lo decide
       después el emprendedor, no el orden en que se fusionó. */
    const r = await db(ctx)
      .from('contact_identities')
      .update({ contact_id: winnerId, is_primary: false })
      .eq('id', ident.id);

    if (r.error) {
      if (esDuplicado(r.error)) continue; // el ganador ya la tenía: nada que mover
      throw fallo(r.error, 'mover identidad');
    }
    movidas += 1;
  }

  // ── 2. Etiquetas ─────────────────────────────────────────────────────────
  const etiquetas = lista(
    await db(ctx).from('contact_tags').select('*').eq('contact_id', loserId),
    'etiquetas del perdedor',
  ) as unknown as FilaEtiqueta[];

  for (const et of etiquetas) {
    const alta = await db(ctx)
      .from('contact_tags')
      .insert({ contact_id: winnerId, tag: et.tag, added_by: et.added_by });
    if (alta.error && !esDuplicado(alta.error)) throw fallo(alta.error, 'mover etiqueta');
  }
  const bajaEtiquetas = await db(ctx).from('contact_tags').delete().eq('contact_id', loserId);
  if (bajaEtiquetas.error) throw fallo(bajaEtiquetas.error, 'limpiar etiquetas del perdedor');

  // ── 3. Posiciones de embudo ──────────────────────────────────────────────
  const posiciones = lista(
    await db(ctx).from('contact_stages').select('*').eq('contact_id', loserId),
    'posiciones del perdedor',
  ) as unknown as FilaPosicion[];

  const delGanador = lista(
    await db(ctx).from('contact_stages').select('pipeline_id').eq('contact_id', winnerId),
    'posiciones del ganador',
  ) as unknown as Array<{ pipeline_id: string }>;
  const embudosOcupados = new Set(delGanador.map((p) => p.pipeline_id));

  /* Las que se van a DESCARTAR: el perdedor estaba en un embudo que el ganador
     ya ocupa. La decisión de no mover al ganador es correcta y no cambia aquí
     —retrocederlo en el embudo sin que nadie lo pidiera sería peor—, pero el
     `delete` de abajo se llevaba la posición Y SU MONTO sin dejar rastro: ni
     `payload.loser` (que es la fila de `contacts`, sin `stage_id` ni `amount`)
     ni el evento `merged` los guardaban. Un trato de 250,000 en Negociación
     desaparecía del tablero entre dos recargas y nadie podía decir de qué
     etapa salió. Y "deshacer la fusión poniendo `merged_into = NULL`" —lo que
     promete el handoff §6.2— devolvía un contacto sin embudo.

     No cambia el criterio de negocio: sólo deja de perder la información. */
  const descartadas = posiciones.filter((p) => embudosOcupados.has(p.pipeline_id));

  for (const pos of posiciones) {
    /* Si el ganador YA está en ese embudo, se queda donde está: la etapa del
       ganador es la que el emprendedor eligió al fusionar hacia él. Mover al
       ganador a la etapa del perdedor sería retrocederlo en el embudo sin que
       nadie lo pidiera. */
    if (embudosOcupados.has(pos.pipeline_id)) continue;

    const r = await db(ctx)
      .from('contact_stages')
      .update({ contact_id: winnerId, updated_at: ahora() })
      .eq('contact_id', loserId)
      .eq('pipeline_id', pos.pipeline_id);
    if (r.error && !esDuplicado(r.error)) throw fallo(r.error, 'mover posición de embudo');
  }
  const bajaPos = await db(ctx).from('contact_stages').delete().eq('contact_id', loserId);
  if (bajaPos.error) throw fallo(bajaPos.error, 'limpiar posiciones del perdedor');

  // ── 4. Línea de tiempo ───────────────────────────────────────────────────
  const eventos = await db(ctx)
    .from('contact_events')
    .update({ contact_id: winnerId })
    .eq('contact_id', loserId)
    .select('id');
  if (eventos.error) throw fallo(eventos.error, 'mover línea de tiempo');
  const movidosEventos = ((eventos.data ?? []) as unknown[]).length;

  // ── 5. Bitácora ──────────────────────────────────────────────────────────
  const bitacora = await db(ctx).from('contact_merges').insert({
    winner_id: winnerId,
    loser_id: loserId,
    merged_by: i.actor ?? null,
    payload: {
      loser: perdedor,
      movedIdentities: movidas,
      movedEvents: movidosEventos,
      // Lo único que la fusión destruye de verdad. Sin esto, "la bitácora
      // guarda qué se movió" era falso justo para el dato que cuesta dinero.
      discardedPlacements: descartadas,
    },
  });
  if (bitacora.error) throw fallo(bitacora.error, 'registrar la fusión');

  // ── 6. Marcar. Lo último. ────────────────────────────────────────────────
  const marca = await db(ctx)
    .from('contacts')
    .update({ merged_into: winnerId, merged_at: ahora(), updated_at: ahora() })
    .eq('id', loserId);
  if (marca.error) throw fallo(marca.error, 'marcar el contacto fusionado');

  // El ganador hereda lo que le falte. Nunca PISA lo que ya tiene: el criterio
  // de la fusión es que el ganador es el bueno.
  const relleno: Record<string, unknown> = { updated_at: ahora() };
  if (!ganador.display_name && perdedor.display_name) relleno.display_name = perdedor.display_name;
  if (!ganador.company_name && perdedor.company_name) relleno.company_name = perdedor.company_name;
  if (!ganador.owner_email && perdedor.owner_email) relleno.owner_email = perdedor.owner_email;
  if (!ganador.locale && perdedor.locale) relleno.locale = perdedor.locale;
  if (Object.keys(relleno).length > 1) {
    const r = await db(ctx).from('contacts').update(relleno).eq('id', winnerId);
    if (r.error) throw fallo(r.error, 'completar datos del ganador');
  }

  await registrarEvento(ctx, {
    contactId: winnerId,
    type: 'merged',
    summary:
      `Se fusionó "${perdedor.display_name ?? loserId}" en este contacto` +
      (await resumenDescartes(ctx, descartadas)),
    payload: {
      loserId,
      movedIdentities: movidas,
      movedEvents: movidosEventos,
      discardedPlacements: descartadas,
    },
    actor: i.actor ?? 'system',
  });

  return { winnerId, movedIdentities: movidas, movedEvents: movidosEventos };
}

/**
 * La frase que se le agrega al evento `merged` cuando la fusión descartó una
 * posición de embudo.
 *
 * Se escribe en la ficha y no sólo en `contact_merges` porque la ficha es donde
 * el emprendedor va a buscar por qué su tablero bajó de 250,000 a 0. Una
 * bitácora que hay que consultar por SQL no es una respuesta para él.
 *
 * Nunca lanza: es texto de bitácora. Si el catálogo de embudos no se puede
 * leer, se cae al identificador — decir menos es aceptable, tumbar la fusión ya
 * consumada no lo es.
 */
async function resumenDescartes(
  ctx: TenantContext,
  descartadas: FilaPosicion[],
): Promise<string> {
  if (descartadas.length === 0) return '';

  let nombres = new Map<string, string>();
  let etapas = new Map<string, string>();
  try {
    const [e, s] = await Promise.all([
      db(ctx).from('pipelines').select('id, name'),
      db(ctx).from('pipeline_stages').select('id, name'),
    ]);
    nombres = new Map(
      (lista(e, 'embudos para la bitácora') as unknown as Array<{ id: string; name: string }>).map(
        (f) => [f.id, f.name],
      ),
    );
    etapas = new Map(
      (lista(s, 'etapas para la bitácora') as unknown as Array<{ id: string; name: string }>).map(
        (f) => [f.id, f.name],
      ),
    );
  } catch {
    /* se sigue con los ids */
  }

  const piezas = descartadas.map((p) => {
    const embudo = nombres.get(p.pipeline_id) ?? p.pipeline_id;
    const etapa = etapas.get(p.stage_id) ?? p.stage_id;
    const monto = aNumero(p.amount);
    const dinero =
      monto === null || monto === 0
        ? ''
        : ` · ${monto.toLocaleString('es-MX', { style: 'currency', currency: p.currency ?? 'MXN', maximumFractionDigits: 0 })}`;
    return `${embudo} · ${etapa}${dinero}`;
  });

  return (
    `. Se descartó su posición en ${piezas.join('; ')} — el ganador ya estaba ` +
    'en ese embudo y no se le retrocede. Queda en la bitácora de la fusión.'
  );
}

async function leerFila(ctx: TenantContext, id: string): Promise<FilaContacto> {
  const r = await db(ctx).from('contacts').select('*').eq('id', id).limit(1);
  if (r.error) throw fallo(r.error, 'leer contacto para fusionar');
  const filas = (r.data ?? []) as unknown as FilaContacto[];
  const fila = filas[0];
  if (!fila) throw new PlatformError('NOT_FOUND', `No existe el contacto ${id}`);
  return fila;
}

// ════════════════════════════════════════════════════════════════════════════
// Detección
// ════════════════════════════════════════════════════════════════════════════

export interface ParDuplicado {
  aId: string;
  bId: string;
  reason: string;
  score: number;
}

/**
 * Pares que probablemente son la misma persona.
 *
 * Tres señales, de más a menos confiable:
 *
 *   0.95 — mismos últimos 10 dígitos en canales de teléfono. Es el duplicado
 *          que el índice único NO puede atrapar, porque `+528146811675` y
 *          `8146811675` son llaves distintas y `normalizarTelefono` se niega a
 *          inventar el país del segundo. Aquí se propone lo que allá no se
 *          adivinó.
 *   0.80 — el mismo identificador en canales DISTINTOS. El correo que usó en
 *          el formulario y el correo con el que escribe por email.
 *   0.55 — mismo nombre visible, normalizado. Débil a propósito: "Juan Pérez"
 *          hay muchos, y por eso queda abajo del umbral de sugerencia fuerte.
 *
 * Nunca fusiona. Devuelve la propuesta ordenada por puntaje.
 */
export async function detectarDuplicados(
  ctx: TenantContext,
  i: { limit?: number } = {},
): Promise<ParDuplicado[]> {
  const tope = Math.min(Math.max(i.limit ?? 20, 1), 100);

  const contactos = lista(
    await db(ctx).from('contacts').select('id, display_name, merged_into').limit(2000),
    'contactos para deduplicar',
  ) as unknown as Array<{ id: string; display_name: string | null; merged_into: string | null }>;

  const vivos = new Map(contactos.filter((c) => !c.merged_into).map((c) => [c.id, c]));
  if (vivos.size < 2) return [];

  const identidades = lista(
    await db(ctx).from('contact_identities').select('contact_id, channel, identifier').limit(5000),
    'identidades para deduplicar',
  ) as unknown as Array<{ contact_id: string; channel: string; identifier: string }>;

  const pares = new Map<string, ParDuplicado>();
  const anotar = (a: string, b: string, reason: string, score: number): void => {
    if (a === b || !vivos.has(a) || !vivos.has(b)) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const llave = `${x}|${y}`;
    const previo = pares.get(llave);
    // Gana la señal más fuerte: un par que coincide por teléfono Y por nombre
    // se reporta una vez, con la razón que de verdad convence.
    if (!previo || previo.score < score) pares.set(llave, { aId: x, bId: y, reason, score });
  };

  // ── Señal 1: misma cola telefónica ───────────────────────────────────────
  const porCola = new Map<string, Set<string>>();
  for (const id of identidades) {
    if (id.channel !== 'whatsapp' && id.channel !== 'sms') continue;
    const cola = colaTelefonica(id.identifier);
    if (!cola) continue;
    if (!porCola.has(cola)) porCola.set(cola, new Set());
    porCola.get(cola)?.add(id.contact_id);
  }
  for (const [cola, ids] of porCola) {
    const arr = [...ids];
    for (let a = 0; a < arr.length; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        anotar(arr[a] ?? '', arr[b] ?? '', `Mismo número, terminación ${cola}`, 0.95);
      }
    }
  }

  // ── Señal 2: mismo identificador en canales distintos ────────────────────
  const porIdentificador = new Map<string, Set<string>>();
  for (const id of identidades) {
    const llave = id.identifier;
    if (!porIdentificador.has(llave)) porIdentificador.set(llave, new Set());
    porIdentificador.get(llave)?.add(id.contact_id);
  }
  for (const [ident, ids] of porIdentificador) {
    const arr = [...ids];
    for (let a = 0; a < arr.length; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        anotar(arr[a] ?? '', arr[b] ?? '', `Mismo identificador "${ident}" en dos canales`, 0.8);
      }
    }
  }

  // ── Señal 3: mismo nombre ────────────────────────────────────────────────
  const porNombre = new Map<string, string[]>();
  for (const c of vivos.values()) {
    // `sinAcentos` para que "José Pérez" y "Jose Perez" caigan en la misma llave.
    const n = sinAcentos(c.display_name ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (n.length < 4) continue;
    porNombre.set(n, [...(porNombre.get(n) ?? []), c.id]);
  }
  for (const [nombre, ids] of porNombre) {
    if (ids.length < 2) continue;
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        anotar(ids[a] ?? '', ids[b] ?? '', `Mismo nombre: "${nombre}"`, 0.55);
      }
    }
  }

  return [...pares.values()].sort((a, b) => b.score - a.score).slice(0, tope);
}
