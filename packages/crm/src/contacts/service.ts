/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Contactos e identidades
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El corazón de este archivo es `resolverPorIdentidad`. Todo lo demás es CRUD.
 */
import { PlatformError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import type {
  Contact,
  ContactIdentity,
  ContactPlacement,
  CreateContactInput,
  IdentityChannel,
  IdentityInput,
  Lifecycle,
  ListContactsInput,
  ListContactsResult,
  ResolveInput,
  UpdateContactInput,
} from '../port';
import type {
  FilaContacto,
  FilaEmbudo,
  FilaEtapa,
  FilaEtiqueta,
  FilaIdentidad,
  FilaPosicion,
} from '../types';
import { aNumero, ahora, db, escaparFiltro, esDuplicado, fallo, lista } from '../store';
import { esGrupo, normalizarIdentidad } from '../identity';
import { emitir } from '../events';
import { registrarEvento } from '../timeline/service';

const CICLOS: ReadonlySet<string> = new Set([
  'lead',
  'prospect',
  'customer',
  'churned',
  'unknown',
]);

/** Profundidad máxima de la cadena de fusiones antes de gritar. */
const MAX_SALTOS_FUSION = 20;

/**
 * Cuántos ids como máximo se resuelven en el primer paso de un filtro por
 * etiqueta o por etapa antes de que la URL de PostgREST reviente. 1000 UUIDs
 * son ~40 KB de query string; nginx corta muy antes.
 */
const TOPE_FILTRO = 1000;

// ════════════════════════════════════════════════════════════════════════════
// Traducción fila → port
// ════════════════════════════════════════════════════════════════════════════

function aIdentidad(f: FilaIdentidad): ContactIdentity {
  return {
    id: f.id,
    channel: f.channel as IdentityChannel,
    identifier: f.identifier,
    raw: f.raw,
    display: f.display,
    verified: f.verified,
    isPrimary: f.is_primary,
    createdAt: f.created_at,
  };
}

function aContacto(
  f: FilaContacto,
  identities: ContactIdentity[],
  tags: string[],
  placements: ContactPlacement[],
): Contact {
  return {
    id: f.id,
    displayName: f.display_name,
    firstName: f.first_name,
    lastName: f.last_name,
    companyName: f.company_name,
    ownerEmail: f.owner_email,
    lifecycle: (CICLOS.has(f.lifecycle) ? f.lifecycle : 'unknown') as Lifecycle,
    source: f.source,
    locale: f.locale,
    custom: f.custom ?? {},
    mergedInto: f.merged_into,
    lastActivityAt: f.last_activity_at,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
    identities,
    tags,
    placements,
  };
}

/** Nombre a mostrar a partir de lo que haya. Nunca devuelve cadena vacía. */
export function nombreVisible(i: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  const explicito = i.displayName?.trim();
  if (explicito) return explicito;
  const compuesto = [i.firstName?.trim(), i.lastName?.trim()].filter(Boolean).join(' ').trim();
  return compuesto || null;
}

// ════════════════════════════════════════════════════════════════════════════
// Hidratación
// ════════════════════════════════════════════════════════════════════════════

/**
 * Carga identidades, etiquetas y posiciones de un lote de contactos en tres
 * consultas, no en tres por contacto.
 *
 * La lista de contactos de GARDEN pide las etiquetas de cada fila por separado
 * (`contacts/service.ts:113` y siguientes): 50 contactos son 51 consultas. Con
 * `in()` son cuatro en total, siempre.
 */
async function hidratar(
  ctx: TenantContext,
  filas: FilaContacto[],
): Promise<Map<string, { identities: ContactIdentity[]; tags: string[]; placements: ContactPlacement[] }>> {
  const salida = new Map<
    string,
    { identities: ContactIdentity[]; tags: string[]; placements: ContactPlacement[] }
  >();
  for (const f of filas) salida.set(f.id, { identities: [], tags: [], placements: [] });
  if (filas.length === 0) return salida;

  const ids = filas.map((f) => f.id);

  const identidades = lista(
    await db(ctx).from('contact_identities').select('*').in('contact_id', ids),
    'identidades del lote',
  ) as unknown as FilaIdentidad[];
  for (const f of identidades) salida.get(f.contact_id)?.identities.push(aIdentidad(f));

  const etiquetas = lista(
    await db(ctx).from('contact_tags').select('*').in('contact_id', ids),
    'etiquetas del lote',
  ) as unknown as FilaEtiqueta[];
  for (const f of etiquetas) salida.get(f.contact_id)?.tags.push(f.tag);

  const posiciones = lista(
    await db(ctx).from('contact_stages').select('*').in('contact_id', ids),
    'posiciones del lote',
  ) as unknown as FilaPosicion[];

  if (posiciones.length > 0) {
    const { embudos, etapas } = await catalogoEmbudos(ctx);
    for (const p of posiciones) {
      const embudo = embudos.get(p.pipeline_id);
      const etapa = etapas.get(p.stage_id);
      if (!embudo || !etapa) continue; // catálogo borrado a media lectura
      salida.get(p.contact_id)?.placements.push({
        pipelineId: embudo.id,
        pipelineSlug: embudo.slug,
        pipelineName: embudo.name,
        stageId: etapa.id,
        stageSlug: etapa.slug,
        stageName: etapa.name,
        stagePosition: etapa.position,
        probability: etapa.probability,
        isWon: etapa.is_won,
        isLost: etapa.is_lost,
        amount: aNumero(p.amount),
        currency: p.currency,
        enteredAt: p.entered_at,
      });
    }
  }

  // Orden estable: la identidad principal primero, luego por antigüedad.
  for (const v of salida.values()) {
    v.identities.sort((a, b) =>
      a.isPrimary === b.isPrimary ? a.createdAt.localeCompare(b.createdAt) : a.isPrimary ? -1 : 1,
    );
    v.tags.sort();
    v.placements.sort((a, b) => a.pipelineName.localeCompare(b.pipelineName));
  }

  return salida;
}

/**
 * Embudos y etapas del tenant, indexados.
 *
 * Se leen enteros y se unen en memoria en vez de pedirle a PostgREST un
 * `select` embebido: un negocio tiene dos o tres embudos con seis etapas cada
 * uno. Traer 20 filas y unirlas aquí cuesta menos que una consulta anidada, y
 * se puede probar sin una base viva.
 */
export async function catalogoEmbudos(
  ctx: TenantContext,
): Promise<{ embudos: Map<string, FilaEmbudo>; etapas: Map<string, FilaEtapa> }> {
  const [e, s] = await Promise.all([
    db(ctx).from('pipelines').select('*'),
    db(ctx).from('pipeline_stages').select('*'),
  ]);
  const embudos = new Map<string, FilaEmbudo>();
  for (const f of lista(e, 'embudos') as unknown as FilaEmbudo[]) embudos.set(f.id, f);
  const etapas = new Map<string, FilaEtapa>();
  for (const f of lista(s, 'etapas') as unknown as FilaEtapa[]) etapas.set(f.id, f);
  return { embudos, etapas };
}

// ════════════════════════════════════════════════════════════════════════════
// Lectura
// ════════════════════════════════════════════════════════════════════════════

export async function leerContacto(
  ctx: TenantContext,
  contactId: string,
): Promise<Contact | null> {
  const r = await db(ctx).from('contacts').select('*').eq('id', contactId).limit(1);
  if (r.error) throw fallo(r.error, 'leer contacto');
  const filas = (r.data ?? []) as unknown as FilaContacto[];
  const fila = filas[0];
  if (!fila) return null;

  const extra = await hidratar(ctx, [fila]);
  const partes = extra.get(fila.id) ?? { identities: [], tags: [], placements: [] };
  return aContacto(fila, partes.identities, partes.tags, partes.placements);
}

export async function listarContactos(
  ctx: TenantContext,
  i: ListContactsInput = {},
): Promise<ListContactsResult> {
  const limite = Math.min(Math.max(i.limit ?? 50, 1), 200);
  const desde = Math.max(i.offset ?? 0, 0);

  /* Filtrar por etapa o por etiqueta obliga a resolver primero QUÉ contactos
     cumplen, porque viven en otra tabla. Se hace en dos pasos y no con un
     `select` embebido para que la consulta siga siendo legible y probable.

     ── El tope, y por qué no se trunca callando ────────────────────────────
     El segundo paso mete los ids en `.in('id', [...])`, que supabase-js
     serializa como query string. 600 UUIDs son ~24 KB de URL; PostgREST detrás
     de nginx corta las cabeceras muy por debajo de eso
     (`large_client_header_buffers` son 8 KB por defecto), así que la pantalla
     devolvía un 414 y el emprendedor veía un error genérico de red en vez de
     su lista. En pruebas no aparecía porque un doble en memoria no tiene URL
     que desbordar.

     Se acota, y cuando el tope se alcanza se DICE (`filterTruncated`).
     Truncar en silencio cambiaría un error visible por un dato falso, que es
     peor. */
  let idsPermitidos: string[] | null = null;
  let filtroTruncado = false;

  if (i.tag) {
    const filas = lista(
      await db(ctx)
        .from('contact_tags')
        .select('contact_id')
        .eq('tag', i.tag)
        .limit(TOPE_FILTRO + 1),
      'contactos por etiqueta',
    ) as unknown as Array<{ contact_id: string }>;
    if (filas.length > TOPE_FILTRO) filtroTruncado = true;
    idsPermitidos = filas.slice(0, TOPE_FILTRO).map((f) => f.contact_id);
  }

  if (i.stageId || i.pipelineId) {
    let q = db(ctx)
      .from('contact_stages')
      .select('contact_id')
      .limit(TOPE_FILTRO + 1);
    if (i.stageId) q = q.eq('stage_id', i.stageId);
    if (i.pipelineId) q = q.eq('pipeline_id', i.pipelineId);
    const filas = lista(await q, 'contactos por etapa') as unknown as Array<{ contact_id: string }>;
    if (filas.length > TOPE_FILTRO) filtroTruncado = true;
    const porEtapa = new Set(filas.slice(0, TOPE_FILTRO).map((f) => f.contact_id));
    idsPermitidos =
      idsPermitidos === null ? [...porEtapa] : idsPermitidos.filter((id) => porEtapa.has(id));
  }

  // Un filtro que no dejó a nadie: la respuesta es vacía, no "todos".
  if (idsPermitidos !== null && idsPermitidos.length === 0) {
    return { contacts: [], total: 0, ...(filtroTruncado ? { filterTruncated: true } : {}) };
  }

  let q = db(ctx).from('contacts').select('*', { count: 'exact' });

  if (!i.includeMerged) q = q.is('merged_into', null);
  if (i.ownerEmail) q = q.eq('owner_email', i.ownerEmail);
  if (i.lifecycle) q = q.eq('lifecycle', i.lifecycle);
  if (idsPermitidos !== null) q = q.in('id', idsPermitidos);

  const busqueda = i.search?.trim();
  if (busqueda) {
    const idsPorIdentidad = await buscarPorIdentidad(ctx, busqueda);
    const t = escaparFiltro(busqueda);
    const partes = [`display_name.ilike.*${t}*`, `company_name.ilike.*${t}*`];
    if (idsPorIdentidad.length > 0) partes.push(`id.in.(${idsPorIdentidad.join(',')})`);
    q = q.or(partes.join(','));
  }

  const r = await q.order('last_activity_at', { ascending: false }).range(desde, desde + limite - 1);
  if (r.error) throw fallo(r.error, 'listar contactos');

  const filas = (r.data ?? []) as unknown as FilaContacto[];
  const extra = await hidratar(ctx, filas);

  return {
    contacts: filas.map((f) => {
      const p = extra.get(f.id) ?? { identities: [], tags: [], placements: [] };
      return aContacto(f, p.identities, p.tags, p.placements);
    }),
    total: r.count ?? filas.length,
    ...(filtroTruncado ? { filterTruncated: true } : {}),
  };
}

/** Contactos cuyo identificador contiene el texto buscado. */
async function buscarPorIdentidad(ctx: TenantContext, texto: string): Promise<string[]> {
  const t = escaparFiltro(texto);
  if (!t) return [];
  const filas = lista(
    await db(ctx)
      .from('contact_identities')
      .select('contact_id')
      .ilike('identifier', `*${t.replace(/\s+/g, '')}*`)
      .limit(200),
    'búsqueda por identidad',
  ) as unknown as Array<{ contact_id: string }>;
  return [...new Set(filas.map((f) => f.contact_id))];
}

// ════════════════════════════════════════════════════════════════════════════
// La cadena de fusión
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sigue `merged_into` hasta el contacto que sigue vivo.
 *
 * Si A se fusionó en B y B en C, la identidad que apuntaba a A tiene que
 * resolver a C. Sin esto, un hilo de WhatsApp de hace tres meses abriría una
 * tarjeta que el emprendedor ya no ve en su lista, y parecería que se perdió.
 *
 * El tope de saltos no es paranoia decorativa: `merged_into` es una FK a la
 * misma tabla y nada en Postgres impide un ciclo A→B→A si alguien escribe mal
 * dos veces. Sin tope, esta función cuelga el proceso.
 */
export async function seguirFusion(ctx: TenantContext, contactId: string): Promise<string> {
  let actual = contactId;
  const vistos = new Set<string>([actual]);

  for (let i = 0; i < MAX_SALTOS_FUSION; i++) {
    const r = await db(ctx).from('contacts').select('id, merged_into').eq('id', actual).limit(1);
    if (r.error) throw fallo(r.error, 'seguir fusión');
    const filas = (r.data ?? []) as unknown as Array<{ id: string; merged_into: string | null }>;
    const fila = filas[0];
    if (!fila || !fila.merged_into) return actual;

    if (vistos.has(fila.merged_into)) {
      throw new PlatformError(
        'INTERNAL',
        `Ciclo de fusión detectado en el contacto ${contactId}. ` +
          'Alguien fusionó A en B y B en A; hay que romper la cadena a mano ' +
          '(UPDATE app.contacts SET merged_into = NULL WHERE id = …).',
        { details: { contactId, cadena: [...vistos] } },
      );
    }
    vistos.add(fila.merged_into);
    actual = fila.merged_into;
  }

  throw new PlatformError(
    'INTERNAL',
    `Cadena de fusión de más de ${MAX_SALTOS_FUSION} saltos desde ${contactId}.`,
    { details: { contactId } },
  );
}

// ════════════════════════════════════════════════════════════════════════════
// resolveByIdentity — la puerta de entrada de H6
// ════════════════════════════════════════════════════════════════════════════

/**
 * Identidad de canal → contacto, creándolo si hace falta.
 *
 * ── Por qué el orden es INSERT-primero y no SELECT-primero ──────────────────
 *
 * El camino obvio es "busca, y si no está créalo". Ese camino tiene una
 * carrera: dos webhooks del mismo número que llegan con 3 ms de diferencia
 * hacen los dos su SELECT (nada), y los dos su INSERT. Sin restricción
 * quedan dos contactos; con restricción, uno revienta con un 500 y el mensaje
 * se pierde.
 *
 * Aquí se busca primero igual (el 99 % de los mensajes son de contactos que ya
 * existen y esa lectura es una consulta barata), pero el árbitro real es el
 * índice único: si el INSERT choca con 23505, se relee y se devuelve al
 * ganador. Ese `catch` ES la corrección, no una red de seguridad.
 */
export async function resolverPorIdentidad(
  ctx: TenantContext,
  i: ResolveInput,
): Promise<{ contactId: string; created: boolean }> {
  if (esGrupo(i.identifier)) {
    throw new PlatformError(
      'VALIDATION',
      `"${i.identifier}" es un grupo de WhatsApp, no una persona. ` +
        'Un grupo no tiene ficha de CRM: crea una por cada grupo al que agreguen ' +
        'el número del negocio y la lista se vuelve basura en una semana.',
    );
  }

  const { channel, identifier, raw } = normalizarIdentidad(i.channel, i.identifier);

  const existente = await buscarIdentidad(ctx, channel, identifier);
  if (existente) {
    return { contactId: await seguirFusion(ctx, existente.contact_id), created: false };
  }

  // No estaba. Se crea el contacto y su identidad.
  const contactId = await insertarContacto(ctx, {
    displayName: i.name,
    source: i.source ?? channel,
    lifecycle: 'lead',
  });

  const r = await db(ctx)
    .from('contact_identities')
    .insert({
      contact_id: contactId,
      channel,
      identifier,
      raw,
      display: i.name ?? null,
      verified: false,
      is_primary: true,
    })
    .select('id');

  if (r.error) {
    if (!esDuplicado(r.error)) throw fallo(r.error, 'crear identidad');

    /* Otro webhook ganó la carrera entre nuestro SELECT y nuestro INSERT.
       El contacto que acabamos de crear queda huérfano: se borra para no
       dejar una tarjeta vacía en la lista del emprendedor. Borrar aquí es
       seguro — nadie más lo vio todavía; se acaba de crear en esta llamada. */
    await db(ctx).from('contacts').delete().eq('id', contactId);

    const ganador = await buscarIdentidad(ctx, channel, identifier);
    if (!ganador) {
      throw new PlatformError(
        'CONFLICT',
        `La identidad ${channel}:${identifier} chocó con el índice único pero no se ` +
          'pudo releer. Reintenta.',
        { retryable: true },
      );
    }
    return { contactId: await seguirFusion(ctx, ganador.contact_id), created: false };
  }

  await registrarEvento(ctx, {
    contactId,
    type: 'contact_created',
    summary: `Contacto creado desde ${channel}`,
    payload: { channel, identifier },
    actor: i.actor ?? 'system',
    source: 'crm',
  });

  const emitido = await emitir(ctx, 'contact_created', { contactId, channel, identifier });
  if (!emitido) await anotarFlujoNoDisparado(ctx, contactId, 'contact_created');

  return { contactId, created: true };
}

async function buscarIdentidad(
  ctx: TenantContext,
  channel: string,
  identifier: string,
): Promise<FilaIdentidad | null> {
  const r = await db(ctx)
    .from('contact_identities')
    .select('*')
    .eq('channel', channel)
    .eq('identifier', identifier)
    .limit(1);
  if (r.error) throw fallo(r.error, 'buscar identidad');
  const filas = (r.data ?? []) as unknown as FilaIdentidad[];
  return filas[0] ?? null;
}

/**
 * Deja constancia de que una automatización no se disparó.
 *
 * Es la diferencia entre "mi flujo no corrió y no sé por qué" y "el motor de
 * flujos estaba caído a las 3:14". Sin esta línea, un `tryPort` que devuelve
 * `null` es un silencio perfecto.
 */
async function anotarFlujoNoDisparado(
  ctx: TenantContext,
  contactId: string,
  trigger: string,
): Promise<void> {
  await registrarEvento(ctx, {
    contactId,
    type: 'field_changed',
    summary: `El disparador "${trigger}" no salió: el motor de automatizaciones no respondió`,
    payload: { trigger, delivered: false },
    actor: 'system',
    source: 'crm',
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Escritura
// ════════════════════════════════════════════════════════════════════════════

async function insertarContacto(
  ctx: TenantContext,
  i: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
    ownerEmail?: string;
    lifecycle?: Lifecycle;
    source?: string;
    locale?: string;
    custom?: Record<string, unknown>;
  },
): Promise<string> {
  const t = ahora();
  const r = await db(ctx)
    .from('contacts')
    .insert({
      display_name: nombreVisible(i),
      first_name: i.firstName?.trim() || null,
      last_name: i.lastName?.trim() || null,
      company_name: i.companyName?.trim() || null,
      owner_email: i.ownerEmail?.trim().toLowerCase() || null,
      lifecycle: i.lifecycle && CICLOS.has(i.lifecycle) ? i.lifecycle : 'lead',
      source: i.source ?? null,
      locale: i.locale ?? null,
      custom: i.custom ?? {},
      last_activity_at: t,
      created_at: t,
      updated_at: t,
    })
    .select('id');

  if (r.error) throw fallo(r.error, 'crear contacto');
  const filas = (r.data ?? []) as Array<{ id: string }>;
  const id = filas[0]?.id;
  if (!id) throw new PlatformError('INTERNAL', 'crear contacto: el INSERT no devolvió id');
  return id;
}

export async function crearContacto(
  ctx: TenantContext,
  i: CreateContactInput,
): Promise<{ contactId: string }> {
  /* Las identidades se normalizan ANTES de crear nada. Si una viene rota, el
     contacto no llega a existir — mejor que dejar una tarjeta a medias que
     alguien tendrá que limpiar. */
  const identidades = (i.identities ?? []).map((x) => ({
    ...normalizarIdentidad(x.channel, x.identifier),
    display: x.display ?? null,
    verified: x.verified ?? false,
    isPrimary: x.isPrimary ?? false,
  }));

  const contactId = await insertarContacto(ctx, i);

  /* Cuál es la principal de cada canal se decide ANTES de escribir nada, no
     sobre la marcha.

     El índice parcial `(tenant_id, contact_id, channel) WHERE is_primary` de
     120 admite UNA sola. Calcularlo dentro del bucle con
     `ident.isPrimary || !yaHayPrincipal.has(canal)` mandaba dos identidades
     marcadas `isPrimary: true` del mismo canal —"una persona con dos
     teléfonos", el caso de la portada de este carril— con `is_primary: true`
     las dos: la segunda chocaba con 23505 y el `catch` de abajo la descartaba
     anotando "ya pertenece a otro contacto", que era FALSO. El número se
     perdía, la operación devolvía 200 y la ficha mandaba a buscar un duplicado
     inexistente.

     La regla: gana la primera del canal que venga marcada; si ninguna viene
     marcada, la primera del canal. Las demás entran como secundarias, que es
     el dato correcto y no una pérdida. */
  const principalDelCanal = new Map<string, number>();
  identidades.forEach((ident, indice) => {
    const elegida = principalDelCanal.get(ident.channel);
    if (elegida === undefined) {
      principalDelCanal.set(ident.channel, indice);
    } else if (ident.isPrimary && !identidades[elegida]?.isPrimary) {
      principalDelCanal.set(ident.channel, indice);
    }
  });

  for (const [indice, ident] of identidades.entries()) {
    const principal = principalDelCanal.get(ident.channel) === indice;

    const r = await db(ctx)
      .from('contact_identities')
      .insert({
        contact_id: contactId,
        channel: ident.channel,
        identifier: ident.identifier,
        raw: ident.raw,
        display: ident.display,
        verified: ident.verified,
        is_primary: principal,
      })
      .select('id');

    if (r.error && !esDuplicado(r.error)) throw fallo(r.error, 'crear identidad');
    if (r.error && esDuplicado(r.error)) {
      /* Aquí caen DOS 23505 distintos y decir el equivocado manda a quien lo
         lea a buscar un contacto duplicado que no existe. Se distinguen
         preguntando quién es el dueño de verdad. */
      const dueno = await buscarIdentidad(ctx, ident.channel, ident.identifier);

      if (dueno && dueno.contact_id !== contactId) {
        /* La identidad ya es de otro contacto. NO se roba ni se falla: se
           anota. Robarla partiría el historial del otro contacto sin avisar, y
           fallar obligaría a limpiar antes de poder dar de alta a nadie. La
           propuesta de fusión sale sola en findDuplicates(). */
        await registrarEvento(ctx, {
          contactId,
          type: 'identity_added',
          summary: `No se agregó ${ident.channel}:${ident.identifier} — ya pertenece a otro contacto`,
          payload: {
            channel: ident.channel,
            identifier: ident.identifier,
            conflict: true,
            ownedBy: dueno.contact_id,
          },
          actor: i.actor ?? 'system',
        });
      } else if (!dueno) {
        /* Nadie es dueño: el choque fue contra el índice de principal única.
           El dato es bueno; lo que sobra es la marca. Se reintenta como
           secundaria en vez de tirar el teléfono. */
        const reintento = await db(ctx)
          .from('contact_identities')
          .insert({
            contact_id: contactId,
            channel: ident.channel,
            identifier: ident.identifier,
            raw: ident.raw,
            display: ident.display,
            verified: ident.verified,
            is_primary: false,
          })
          .select('id');
        if (reintento.error && !esDuplicado(reintento.error)) {
          throw fallo(reintento.error, 'crear identidad');
        }
      }
    }
  }

  for (const tag of i.tags ?? []) {
    const limpia = tag.trim();
    if (!limpia) continue;
    const r = await db(ctx)
      .from('contact_tags')
      .insert({ contact_id: contactId, tag: limpia, added_by: i.actor ?? null });
    if (r.error && !esDuplicado(r.error)) throw fallo(r.error, 'agregar etiqueta');
  }

  await registrarEvento(ctx, {
    contactId,
    type: 'contact_created',
    summary: 'Contacto creado',
    payload: { source: i.source ?? 'manual' },
    actor: i.actor ?? 'system',
  });

  const emitido = await emitir(ctx, 'contact_created', { contactId });
  if (!emitido) await anotarFlujoNoDisparado(ctx, contactId, 'contact_created');

  return { contactId };
}

export async function actualizarContacto(
  ctx: TenantContext,
  contactId: string,
  i: UpdateContactInput,
): Promise<void> {
  // Se lee SIEMPRE, no sólo cuando cambian los nombres: el UPDATE de abajo va
  // acotado por tenant y sobre un id inexistente afecta 0 filas sin error, así
  // que sin esto un PATCH a un uuid ajeno respondía 200 sin haber hecho nada.
  const actual = await exigirContacto(ctx, contactId);

  const patch: Record<string, unknown> = { updated_at: ahora() };

  if (i.displayName !== undefined || i.firstName !== undefined || i.lastName !== undefined) {
    patch.first_name = i.firstName !== undefined ? i.firstName.trim() || null : actual.first_name;
    patch.last_name = i.lastName !== undefined ? i.lastName.trim() || null : actual.last_name;
    patch.display_name = nombreVisible({
      displayName: i.displayName ?? actual.display_name,
      firstName: patch.first_name as string | null,
      lastName: patch.last_name as string | null,
    });
  }
  if (i.companyName !== undefined) patch.company_name = i.companyName.trim() || null;
  if (i.ownerEmail !== undefined) patch.owner_email = i.ownerEmail.trim().toLowerCase() || null;
  if (i.source !== undefined) patch.source = i.source || null;
  if (i.locale !== undefined) patch.locale = i.locale || null;
  if (i.custom !== undefined) patch.custom = i.custom;

  if (i.lifecycle !== undefined) {
    if (!CICLOS.has(i.lifecycle)) {
      throw new PlatformError('VALIDATION', `Ciclo de vida desconocido: ${i.lifecycle}`);
    }
    patch.lifecycle = i.lifecycle;
  }

  const r = await db(ctx).from('contacts').update(patch).eq('id', contactId);
  if (r.error) throw fallo(r.error, 'actualizar contacto');

  if (i.lifecycle !== undefined) {
    await registrarEvento(ctx, {
      contactId,
      type: 'lifecycle_changed',
      summary: `Ciclo de vida: ${i.lifecycle}`,
      payload: { lifecycle: i.lifecycle },
      actor: i.actor ?? 'system',
    });
  }
}

async function leerFilaContacto(ctx: TenantContext, contactId: string): Promise<FilaContacto> {
  const r = await db(ctx).from('contacts').select('*').eq('id', contactId).limit(1);
  if (r.error) throw fallo(r.error, 'leer contacto');
  const filas = (r.data ?? []) as unknown as FilaContacto[];
  const fila = filas[0];
  if (!fila) throw new PlatformError('NOT_FOUND', `No existe el contacto ${contactId}`);
  return fila;
}

/**
 * El contacto existe Y es de este tenant, o 404.
 *
 * ── Por qué hace falta una función para esto ────────────────────────────────
 *
 * Todos los `contactId` de las rutas vienen del request. La lectura está
 * protegida —`tenantDb(ctx)` filtra por `tenant_id` y un id ajeno simplemente
 * no aparece—, pero la ESCRITURA tenía dos agujeros:
 *
 *   1. Falso éxito. `UPDATE … WHERE id = <uuid que no existe>` acotado por
 *      tenant afecta 0 filas, y PostgREST no lo considera error. Después
 *      `registrarEvento` reventaba con 23503 y se lo tragaba por diseño. La
 *      ruta respondía `{ok:true}`: el usuario veía "asignado" y no se había
 *      asignado nada, ni quedaba anotado en ningún lado.
 *
 *   2. Escritura que cruza la frontera. Las FK de las tablas hijas apuntaban a
 *      `app.contacts(id)` a secas, así que una identidad del tenant A podía
 *      colgarse de un contacto del tenant B. La migración 123 lo vuelve
 *      irrepresentable en la base; esto lo convierte en un 404 legible ANTES,
 *      que es lo que el emprendedor necesita leer.
 *
 * `moveStage` ya fallaba fuerte por accidente (su INSERT tropezaba con la FK).
 * Que unas operaciones fallaran y otras mintieran era parte del problema.
 */
export async function exigirContacto(
  ctx: TenantContext,
  contactId: string,
): Promise<FilaContacto> {
  return leerFilaContacto(ctx, contactId);
}

export async function agregarIdentidad(
  ctx: TenantContext,
  i: { contactId: string; identity: IdentityInput; actor?: string },
): Promise<{ identityId: string; alreadyOwnedBy: string | null }> {
  // El contacto tiene que existir Y ser de este tenant antes de colgarle una
  // fila hija. Sin esto, un `contactId` de otra empresa produce una identidad
  // del tenant A apuntando a un contacto del tenant B (ver migración 123).
  await exigirContacto(ctx, i.contactId);

  const { channel, identifier, raw } = normalizarIdentidad(
    i.identity.channel,
    i.identity.identifier,
  );

  const previa = await buscarIdentidad(ctx, channel, identifier);
  if (previa) {
    // Ya era de este contacto: nada que hacer, y no es un error.
    if (previa.contact_id === i.contactId) {
      return { identityId: previa.id, alreadyOwnedBy: null };
    }
    return { identityId: previa.id, alreadyOwnedBy: previa.contact_id };
  }

  /* Entra SIEMPRE como secundaria y se promueve después.
     `bajarPrincipal()` corría ANTES del INSERT: si el INSERT fallaba —un 23505
     de carrera, una caída de red— el contacto se quedaba sin ninguna identidad
     principal en ese canal, y el nodo `send_message` de H8 deja de tener a
     quién escribirle. Ahora un fallo del INSERT no cambia nada. */
  const r = await db(ctx)
    .from('contact_identities')
    .insert({
      contact_id: i.contactId,
      channel,
      identifier,
      raw,
      display: i.identity.display ?? null,
      verified: i.identity.verified ?? false,
      is_primary: false,
    })
    .select('id');

  if (r.error) {
    if (!esDuplicado(r.error)) throw fallo(r.error, 'agregar identidad');
    const ganador = await buscarIdentidad(ctx, channel, identifier);
    return { identityId: ganador?.id ?? '', alreadyOwnedBy: ganador?.contact_id ?? null };
  }

  const filas = (r.data ?? []) as Array<{ id: string }>;
  const identityId = filas[0]?.id ?? '';

  if (i.identity.isPrimary && identityId) {
    await bajarPrincipal(ctx, i.contactId, channel);
    const ascenso = await db(ctx)
      .from('contact_identities')
      .update({ is_primary: true })
      .eq('id', identityId);
    if (ascenso.error) throw fallo(ascenso.error, 'marcar identidad principal');
  }

  await registrarEvento(ctx, {
    contactId: i.contactId,
    type: 'identity_added',
    summary: `${channel}: ${identifier}`,
    payload: { channel, identifier },
    actor: i.actor ?? 'system',
  });

  return { identityId, alreadyOwnedBy: null };
}

/** Quita el `is_primary` de las demás identidades del mismo canal. */
async function bajarPrincipal(
  ctx: TenantContext,
  contactId: string,
  channel: string,
): Promise<void> {
  const r = await db(ctx)
    .from('contact_identities')
    .update({ is_primary: false })
    .eq('contact_id', contactId)
    .eq('channel', channel);
  if (r.error) throw fallo(r.error, 'bajar identidad principal');
}

export async function asignarDueno(
  ctx: TenantContext,
  i: { contactId: string; ownerEmail: string | null; actor?: string },
): Promise<void> {
  await exigirContacto(ctx, i.contactId);

  const correo = i.ownerEmail?.trim().toLowerCase() || null;
  const r = await db(ctx)
    .from('contacts')
    .update({ owner_email: correo, updated_at: ahora() })
    .eq('id', i.contactId);
  if (r.error) throw fallo(r.error, 'asignar responsable');

  await registrarEvento(ctx, {
    contactId: i.contactId,
    type: 'owner_assigned',
    summary: correo ? `Asignado a ${correo}` : 'Sin responsable',
    payload: { ownerEmail: correo },
    actor: i.actor ?? 'system',
  });
}

export async function agregarEtiqueta(
  ctx: TenantContext,
  i: { contactId: string; tag: string; actor?: string },
): Promise<{ added: boolean }> {
  const tag = i.tag.trim();
  if (!tag) throw new PlatformError('VALIDATION', 'La etiqueta no puede estar vacía');
  await exigirContacto(ctx, i.contactId);

  const r = await db(ctx)
    .from('contact_tags')
    .insert({ contact_id: i.contactId, tag, added_by: i.actor ?? null });

  if (r.error) {
    // Ya la tenía. NO se emite `tag_added`: un flujo que etiqueta y otro que
    // escucha la etiqueta se dispararían en bucle infinito.
    if (esDuplicado(r.error)) return { added: false };
    throw fallo(r.error, 'agregar etiqueta');
  }

  await registrarEvento(ctx, {
    contactId: i.contactId,
    type: 'tag_added',
    summary: `Etiqueta "${tag}"`,
    payload: { tag },
    actor: i.actor ?? 'system',
  });

  const emitido = await emitir(ctx, 'tag_added', { contactId: i.contactId, tag });
  if (!emitido) await anotarFlujoNoDisparado(ctx, i.contactId, 'tag_added');

  return { added: true };
}

export async function quitarEtiqueta(
  ctx: TenantContext,
  i: { contactId: string; tag: string; actor?: string },
): Promise<{ removed: boolean }> {
  await exigirContacto(ctx, i.contactId);

  const tag = i.tag.trim();
  // `.select()` después del DELETE devuelve las filas borradas. Sin él,
  // PostgREST no dice cuántas fueron y `removed` sería siempre una suposición.
  const r = await db(ctx)
    .from('contact_tags')
    .delete()
    .eq('contact_id', i.contactId)
    .eq('tag', tag)
    .select('tag');
  if (r.error) throw fallo(r.error, 'quitar etiqueta');

  const quitadas = ((r.data ?? []) as unknown[]).length;
  if (quitadas > 0) {
    await registrarEvento(ctx, {
      contactId: i.contactId,
      type: 'tag_removed',
      summary: `Se quitó la etiqueta "${tag}"`,
      payload: { tag },
      actor: i.actor ?? 'system',
    });
  }
  return { removed: quitadas > 0 };
}

/** Marca actividad sin escribir en la línea de tiempo. */
export async function tocar(
  ctx: TenantContext,
  contactId: string,
  at?: string,
): Promise<void> {
  await exigirContacto(ctx, contactId);

  const r = await db(ctx)
    .from('contacts')
    .update({ last_activity_at: at ?? ahora() })
    .eq('id', contactId);
  if (r.error) throw fallo(r.error, 'marcar actividad');
}
