/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La ventana de 24 horas de Meta.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es la regla que hace a Instagram y Messenger distintos de WhatsApp, y la que
 *  un driver ingenuo ignora sin enterarse:
 *
 *  > Sólo puedes escribirle libremente a alguien dentro de las **24 horas**
 *  > posteriores a **su** último mensaje. Fuera de esa ventana, Meta rechaza el
 *  > envío salvo que lleve una **etiqueta de mensaje** aprobada.
 *
 *  ── Por qué esto no es un detalle ──────────────────────────────────────────
 *
 *  Un driver que no la implementa **pasa todas las pruebas**. En desarrollo uno
 *  escribe un DM y contesta a los diez segundos: siempre dentro de la ventana,
 *  siempre verde. El fallo aparece con clientes reales al día siguiente, y
 *  aparece como un error del proveedor —código 10, subcódigo 2018278— que se
 *  parece a un problema de permisos. Se depura por el lado equivocado.
 *
 *  Por eso aquí la ventana es un **requisito con estado propio**, no un
 *  `catch` alrededor del envío:
 *
 *    1. Cada mensaje del cliente **abre** la ventana (`registrarEntrante`).
 *    2. Cada envío la **consulta antes de salir** (`decidirEnvio`). Si está
 *       cerrada, se rechaza aquí — sin gastar la llamada a Meta y con un texto
 *       que dice qué pasó y qué hacer.
 *    3. La bandeja puede **enseñarla antes de que falle** (`estadoDeVentana`),
 *       que es el criterio #6 del handoff: que el emprendedor lo vea, no que se
 *       entere por un error.
 *
 *  ── Por qué una tabla propia y no una columna en `threads` ─────────────────
 *
 *  `app.threads` es de H6 y `last_message_at` no sirve: se mueve también con
 *  los SALIENTES, y un saliente NO abre la ventana. Una columna nueva en su
 *  tabla sería un cambio de esquema en el árbol de otro carril, justo lo que el
 *  contrato de no colisión existe para evitar.
 *
 *  La tabla propia además se lleva bien con el contrato del port: `send()`
 *  recibe `channelId` y `address` —no `threadId`—, que es exactamente la llave
 *  de esta tabla. Si colgara del hilo habría que buscarlo primero.
 *
 *  ── La regla del monótono vive en la BASE ──────────────────────────────────
 *
 *  `last_inbound_at` **sólo avanza**. No se cumple con un `if` aquí: un webhook
 *  reintentado fuera de orden llegaría con una fecha vieja y cerraría una
 *  ventana que está abierta. Lo garantiza un trigger de la migración 100
 *  (`meta_ventana_solo_avanza`), así que es cierto para cualquiera que escriba
 *  en la tabla, hoy y dentro de un año.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { log } from '../../logger';
import type { EtiquetaMensaje } from './graph';

/** Las 24 horas, en milisegundos. */
export const VENTANA_MS = 24 * 60 * 60 * 1000;

/**
 * A partir de aquí la bandeja avisa de que la ventana se está cerrando.
 *
 * Dos horas es el margen en el que a un emprendedor todavía le da tiempo de
 * hacer algo: leer el hilo, contestar, cerrar la venta. Avisar a los diez
 * minutos sería avisar de un incendio ya apagado; avisar a las doce horas
 * convierte el aviso en ruido permanente y deja de mirarse.
 */
export const AVISO_MS = 2 * 60 * 60 * 1000;

/** Las etiquetas que Meta acepta fuera de la ventana. */
export const ETIQUETAS_VALIDAS: readonly EtiquetaMensaje[] = [
  'HUMAN_AGENT',
  'CONFIRMED_EVENT_UPDATE',
  'POST_PURCHASE_UPDATE',
  'ACCOUNT_UPDATE',
];

export interface EstadoVentana {
  /** `true` si se puede mandar un mensaje libre ahora mismo. */
  abierta: boolean;
  /** Cuándo escribió el cliente por última vez. `null` = nunca. */
  ultimoEntrante: string | null;
  /** Cuándo se cierra. `null` si nunca ha escrito. */
  cierraEn: string | null;
  /** Minutos que quedan. `0` si ya cerró. */
  minutosRestantes: number;
  /** `true` cuando queda poco: es lo que la bandeja tiene que enseñar. */
  porCerrar: boolean;
}

/**
 * El estado de la ventana a partir de una fecha. Pura, para poder probarla sin
 * base de datos y sin esperar 24 horas.
 */
export function calcularVentana(ultimoEntrante: string | null, ahora: Date = new Date()): EstadoVentana {
  if (!ultimoEntrante) {
    return {
      abierta: false,
      ultimoEntrante: null,
      cierraEn: null,
      minutosRestantes: 0,
      porCerrar: false,
    };
  }

  const desde = new Date(ultimoEntrante).getTime();
  if (!Number.isFinite(desde)) {
    return { abierta: false, ultimoEntrante, cierraEn: null, minutosRestantes: 0, porCerrar: false };
  }

  const cierre = desde + VENTANA_MS;
  const restante = cierre - ahora.getTime();

  return {
    abierta: restante > 0,
    ultimoEntrante,
    cierraEn: new Date(cierre).toISOString(),
    minutosRestantes: restante > 0 ? Math.floor(restante / 60_000) : 0,
    porCerrar: restante > 0 && restante <= AVISO_MS,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Persistencia
// ════════════════════════════════════════════════════════════════════════════

interface FilaVentana {
  last_inbound_at: string | null;
}

/**
 * El cliente escribió: la ventana se abre (o se renueva).
 *
 * Best-effort a propósito, y esto merece explicación porque parece laxo: si
 * esto falla, el mensaje del cliente **ya entró** en la bandeja y el agente ya
 * va a contestarle. Tumbar la ingesta por no poder anotar una marca de tiempo
 * cambiaría un problema pequeño —la ventana se calcula mal en un hilo— por uno
 * grande: el webhook devuelve error, Meta reintrega el lote entero y el cliente
 * recibe la respuesta dos veces.
 */
export async function registrarEntrante(
  ctx: TenantContext,
  i: { channelId: string; address: string; cuando: string },
): Promise<void> {
  try {
    const { error } = await tenantDb(ctx)
      .from('meta_message_windows')
      .upsert(
        {
          channel_id: i.channelId,
          address: i.address,
          last_inbound_at: i.cuando,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,channel_id,address' },
      );
    if (error) throw error;
  } catch (err) {
    log.warn(`meta: no se pudo anotar la ventana de ${i.address}: ${String(err)}`);
  }
}

/** Cuándo escribió por última vez esta persona en este canal. */
export async function ultimoEntranteDe(
  ctx: TenantContext,
  i: { channelId: string; address: string },
): Promise<string | null> {
  const { data, error } = await tenantDb(ctx)
    .from('meta_message_windows')
    .select('last_inbound_at')
    .eq('channel_id', i.channelId)
    .eq('address', i.address)
    .maybeSingle();

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo leer la ventana de Meta: ${error.message}`);
  }
  return (data as FilaVentana | null)?.last_inbound_at ?? null;
}

/**
 * El estado de la ventana de una conversación.
 *
 * Es lo que la bandeja necesita para cumplir el criterio #6 — enseñar que la
 * ventana se cierra **antes** de que el envío falle. El driver lo expone; la
 * pantalla es de H6 y el contrato exacto está en el README.
 */
export async function estadoDeVentana(
  ctx: TenantContext,
  i: { channelId: string; address: string; ahora?: Date },
): Promise<EstadoVentana> {
  return calcularVentana(await ultimoEntranteDe(ctx, i), i.ahora ?? new Date());
}

// ════════════════════════════════════════════════════════════════════════════
// La decisión
// ════════════════════════════════════════════════════════════════════════════

export interface DecisionEnvio {
  /** La etiqueta con la que hay que mandar, o `undefined` si va como respuesta. */
  etiqueta?: EtiquetaMensaje;
  estado: EstadoVentana;
}

/**
 * ¿Se puede mandar este mensaje, y cómo?
 *
 * Tres caminos, y el orden importa:
 *
 *   1. **Ventana abierta** → se manda como `RESPONSE`, sin etiqueta. Es el caso
 *      normal y el 95 % del tráfico.
 *   2. **Cerrada y el canal tiene etiqueta configurada** → se manda con esa
 *      etiqueta. Requiere que Meta se la haya aprobado al negocio; si no, el
 *      rechazo viene de Meta y `errorDeMeta()` lo traduce.
 *   3. **Cerrada y sin etiqueta** → se rechaza AQUÍ, sin llamar a Meta.
 *
 * El caso 3 se rechaza en vez de intentarlo y ver qué dice Meta, y es
 * deliberado: el error de Meta (código 10, subcódigo 2018278) no le explica
 * nada a nadie, y cada intento fallido cuenta contra el límite de la app. Un
 * error nuestro, escrito en español y con la fecha exacta en la que se cerró la
 * ventana, es lo que convierte «no se pudo enviar» en «ya sé qué pasó».
 */
export function decidirEnvio(i: {
  estado: EstadoVentana;
  etiquetaConfigurada?: string | undefined;
  canal: string;
}): DecisionEnvio {
  if (i.estado.abierta) return { estado: i.estado };

  const etiqueta = etiquetaValida(i.etiquetaConfigurada);
  if (etiqueta) return { etiqueta, estado: i.estado };

  throw new PlatformError('CHANNEL_ERROR', explicarCierre(i.estado, i.canal), {
    retryable: false,
    details: {
      ventana: 'cerrada',
      ultimoEntrante: i.estado.ultimoEntrante,
      cerroEn: i.estado.cierraEn,
    },
  });
}

/** El texto que ve un humano cuando la ventana está cerrada. */
export function explicarCierre(estado: EstadoVentana, canal: string): string {
  if (!estado.ultimoEntrante) {
    return (
      `Meta no deja escribir primero en ${canal}: la conversación tiene que abrirla el ` +
      'cliente. Sólo se puede contestar dentro de las 24 horas siguientes a su mensaje.'
    );
  }
  return (
    `La ventana de 24 horas de Meta se cerró el ${estado.cierraEn} (el cliente escribió ` +
    `por última vez el ${estado.ultimoEntrante}). Fuera de ella ${canal} sólo acepta ` +
    'mensajes con una etiqueta aprobada por Meta. Se configura en el canal con ' +
    '`meta_etiqueta_fuera_de_ventana` y requiere que Meta le haya aprobado esa etiqueta ' +
    'al negocio.'
  );
}

/** Una etiqueta sólo se usa si es una de las que Meta acepta. */
export function etiquetaValida(v: unknown): EtiquetaMensaje | undefined {
  const s = String(v ?? '').toUpperCase();
  return ETIQUETAS_VALIDAS.find((e) => e === s);
}
