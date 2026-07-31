/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EL CATÁLOGO — qué proveedores hay, cómo se comprueban, y quién puede caer
 *  al respaldo de la plataforma
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── La tabla que de verdad importa ─────────────────────────────────────────
 *
 *  | proveedor   | ¿respaldo? | por qué                                       |
 *  |-------------|-----------|-----------------------------------------------|
 *  | `resend`    | sí, a mano | Se puede mandar desde el dominio de la
 *  |             |            | plataforma con el nombre del negocio mientras
 *  |             |            | verifica el suyo. Reversible y visible.       |
 *  | `evolution` | **no**     | Compartir la instancia es compartir el NÚMERO.|
 *  | `twilio`    | **no**     | Un número de Twilio es de un negocio, y el
 *  |             |            | registro A2P está a nombre de alguien.        |
 *  | `meta`      | **no**     | Un token de página es de UNA página.          |
 *
 *  Está en el código y no en una variable suelta porque el día que alguien
 *  quiera "destrabar rápido" a un cliente va a leer esto antes de encender el
 *  respaldo del proveedor equivocado. `permitido: false` no lo mueve ninguna
 *  variable de entorno: hay que venir aquí, cambiarlo, y explicárselo a quien
 *  revise el PR.
 *
 *  ── Y `verify()`, que es la otra mitad ─────────────────────────────────────
 *
 *  Cada uno hace una llamada REAL, barata y de sólo lectura. "Capturado" no es
 *  "conectado": el emprendedor pega un token, ve una palomita verde, y tres
 *  días después nadie le contestó a nadie.
 */
import { PlatformError } from '@abraxa/db';
import { codigoDe, cuerpoJson, idDePeticion, motivo } from './sanear';

// ════════════════════════════════════════════════════════════════════════════
// Tipos
// ════════════════════════════════════════════════════════════════════════════

export interface ResultadoVerificacion {
  ok: boolean;
  /** Motivo corto y saneado. `null` cuando salió bien. */
  reason: string | null;
  /** Lo que el proveedor dijo de sí mismo y SÍ se puede guardar. */
  detail: Record<string, unknown>;
  /** La cuenta externa que reportó, si la reportó. */
  externalAccountId: string | null;
  /** Caducidad que reportó el proveedor, si la reporta (tokens de Meta). */
  expiresAt?: string | null;
}

export interface EntradaVerificacion {
  secret: string;
  config: Record<string, unknown>;
  /** La cuenta que el emprendedor dijo que era, para contrastarla. */
  externalAccountId?: string | null;
  fetchImpl: typeof fetch;
}

export interface CampoConfig {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface Respaldo {
  /** Si es `false`, NINGUNA variable de entorno lo enciende. */
  permitido: boolean;
  /** Por qué. Se enseña en la pantalla y se lee en la revisión del PR. */
  razon: string;
}

export interface ProveedorSpec {
  name: string;
  label: string;
  /** Cómo se le llama al secreto en la pantalla, en el idioma del negocio. */
  secretLabel: string;
  configFields: CampoConfig[];
  respaldo: Respaldo;
  /** Qué le falta conectar, dicho para el emprendedor y no para el sistema. */
  queEs: string;
  /** La credencial de la plataforma, si este proveedor la admite. */
  desdeEntorno?(): { secret: string; config: Record<string, unknown> } | null;
  verificar(i: EntradaVerificacion): Promise<ResultadoVerificacion>;
}

// ════════════════════════════════════════════════════════════════════════════
// Utilidades comunes a los cuatro
// ════════════════════════════════════════════════════════════════════════════

/** 8 segundos: una comprobación de salud que tarda más ya es un fallo. */
const TIEMPO_LIMITE_MS = 8_000;

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const sinBarra = (v: string): string => v.replace(/\/+$/, '');

async function pedir(
  i: EntradaVerificacion,
  url: string,
  headers: Record<string, string>,
): Promise<{ r: Response; cuerpo: unknown } | { fallo: ResultadoVerificacion }> {
  try {
    const r = await i.fetchImpl(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });
    return { r, cuerpo: await cuerpoJson(r) };
  } catch (e) {
    // La red, no la credencial. Se distingue a propósito: un `error` por un
    // timeout no significa que el token esté mal, y el mensaje lo dice.
    const nombre = e instanceof Error ? e.name : 'Error';
    return {
      fallo: {
        ok: false,
        reason: motivo(['No se pudo hablar con el proveedor', nombre], [i.secret]),
        detail: { network: true, error: nombre },
        externalAccountId: null,
      },
    };
  }
}

/** El fallo estándar de un HTTP que no salió 2xx, ya saneado. */
function fallaHttp(r: Response, cuerpo: unknown, secret: string): ResultadoVerificacion {
  const codigo = codigoDe(cuerpo, ['error', 'code', 'status', 'message_code']);
  const peticion = idDePeticion(cuerpo, r.headers);
  return {
    ok: false,
    reason: motivo([`HTTP ${r.status}`, codigo, peticion], [secret]),
    detail: { status: r.status, code: codigo, requestId: peticion },
    externalAccountId: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Los cuatro proveedores
// ════════════════════════════════════════════════════════════════════════════

const EVOLUTION: ProveedorSpec = {
  name: 'evolution',
  label: 'WhatsApp (Evolution)',
  secretLabel: 'Llave de la API (apikey)',
  queEs: 'tu WhatsApp',
  configFields: [
    { key: 'baseUrl', label: 'URL del servidor', required: true, placeholder: 'https://…' },
    { key: 'instance', label: 'Nombre de la instancia', required: true },
  ],
  respaldo: {
    permitido: false,
    razon:
      'Compartir la instancia de Evolution es compartir el NÚMERO de WhatsApp. Dos negocios ' +
      'en la misma instancia significa que al cliente de uno le llegan las conversaciones ' +
      'de la clientela del otro.',
  },
  async verificar(i) {
    const baseUrl = sinBarra(texto(i.config.baseUrl));
    const instancia = texto(i.config.instance);
    if (!baseUrl || !instancia) {
      return {
        ok: false,
        reason: 'Faltan la URL del servidor y el nombre de la instancia.',
        detail: {},
        externalAccountId: null,
      };
    }

    const res = await pedir(i, `${baseUrl}/instance/connectionState/${encodeURIComponent(instancia)}`, {
      apikey: i.secret,
      accept: 'application/json',
    });
    if ('fallo' in res) return res.fallo;
    if (!res.r.ok) return fallaHttp(res.r, res.cuerpo, i.secret);

    const cuerpo = (res.cuerpo ?? {}) as { instance?: { state?: string }; state?: string };
    const estado = texto(cuerpo.instance?.state ?? cuerpo.state);
    // 'open' es la instancia conectada al teléfono. 'close' / 'connecting' es
    // una instancia que existe y NO manda: decirle conectada sería la mentira
    // exacta que este carril viene a quitar.
    return {
      ok: estado === 'open',
      reason:
        estado === 'open'
          ? null
          : motivo(['La instancia no está conectada', `estado '${estado || 'desconocido'}'`]),
      detail: { state: estado || null },
      externalAccountId: instancia,
    };
  },
};

const META: ProveedorSpec = {
  name: 'meta',
  label: 'Instagram y Messenger (Meta)',
  secretLabel: 'Token de acceso de la página',
  queEs: 'tu Instagram o Messenger',
  configFields: [
    { key: 'pageId', label: 'ID de la página', required: false },
    { key: 'graphVersion', label: 'Versión de la Graph API', required: false, placeholder: 'v21.0' },
  ],
  respaldo: {
    permitido: false,
    razon:
      'Un token de acceso de página es, por definición, de UNA página de UN negocio. No cabe ' +
      'en una variable del proceso: la app de la plataforma no puede hablar por la página de ' +
      'un cliente con la credencial de otro.',
  },
  async verificar(i) {
    const version = texto(i.config.graphVersion) || 'v21.0';
    const res = await pedir(i, `https://graph.facebook.com/${version}/me?fields=id,name`, {
      authorization: `Bearer ${i.secret}`,
      accept: 'application/json',
    });
    if ('fallo' in res) return res.fallo;
    if (!res.r.ok) return fallaHttp(res.r, res.cuerpo, i.secret);

    const cuerpo = (res.cuerpo ?? {}) as { id?: string; name?: string };
    const id = texto(cuerpo.id);
    if (!id) {
      return {
        ok: false,
        reason: 'Meta contestó sin decir de qué página es el token.',
        detail: {},
        externalAccountId: null,
      };
    }

    // El token vive: falta que sea de la página que el emprendedor dijo. Un
    // token válido de OTRA página conectado aquí mandaría los mensajes de este
    // negocio a la bandeja de otro.
    const declarada = texto(i.externalAccountId ?? '') || texto(i.config.pageId);
    if (declarada && declarada !== id) {
      return {
        ok: false,
        reason: motivo([
          'El token es de otra página',
          `declarada '${declarada}'`,
          `token de '${id}'`,
        ]),
        detail: { pageId: id, declared: declarada },
        externalAccountId: id,
      };
    }

    return {
      ok: true,
      reason: null,
      detail: { pageId: id, pageName: texto(cuerpo.name) || null },
      externalAccountId: id,
    };
  },
};

const TWILIO: ProveedorSpec = {
  name: 'twilio',
  label: 'SMS (Twilio)',
  secretLabel: 'Auth Token',
  queEs: 'tus SMS',
  configFields: [
    { key: 'accountSid', label: 'Account SID', required: true, placeholder: 'AC…' },
    { key: 'fromNumber', label: 'Número remitente', required: false, placeholder: '+52…' },
  ],
  respaldo: {
    permitido: false,
    razon:
      'Un número de Twilio es de un negocio, y el registro A2P está a nombre de alguien. ' +
      'Mandar los SMS de todos los clientes desde el mismo número mezcla conversaciones y ' +
      'pone el cumplimiento de todos a depender de uno.',
  },
  async verificar(i) {
    const sid = texto(i.config.accountSid);
    if (!sid) {
      return { ok: false, reason: 'Falta el Account SID.', detail: {}, externalAccountId: null };
    }

    const basica = Buffer.from(`${sid}:${i.secret}`).toString('base64');
    const res = await pedir(
      i,
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
      { authorization: `Basic ${basica}`, accept: 'application/json' },
    );
    if ('fallo' in res) return res.fallo;
    if (!res.r.ok) return fallaHttp(res.r, res.cuerpo, i.secret);

    const cuerpo = (res.cuerpo ?? {}) as { sid?: string; status?: string };
    const estado = texto(cuerpo.status);
    const activa = estado === '' || estado === 'active';
    return {
      ok: activa,
      reason: activa ? null : motivo(['La cuenta de Twilio no está activa', `estado '${estado}'`]),
      detail: { accountSid: texto(cuerpo.sid) || sid, status: estado || null },
      externalAccountId: texto(cuerpo.sid) || sid,
    };
  },
};

const RESEND: ProveedorSpec = {
  name: 'resend',
  label: 'Correo (Resend)',
  secretLabel: 'API key',
  queEs: 'tu correo',
  configFields: [
    { key: 'domain', label: 'Dominio remitente', required: true, placeholder: 'tunegocio.mx' },
    { key: 'domainId', label: 'ID del dominio en Resend', required: false },
  ],
  respaldo: {
    permitido: true,
    razon:
      'Mientras el negocio verifica su dominio, se puede mandar desde el de la plataforma con ' +
      'su nombre. Es reversible y no mezcla conversaciones. Aun así se registra en la bitácora ' +
      'y se dice en la pantalla: la reputación del dominio de la plataforma la comparten todos.',
  },
  desdeEntorno() {
    const llave = texto(process.env.RESEND_API_KEY);
    if (!llave) return null;
    return {
      secret: llave,
      config: { domain: texto(process.env.RESEND_FROM_DOMAIN) || 'mail.abraxa.club' },
    };
  },
  async verificar(i) {
    const dominioId = texto(i.config.domainId);
    const dominio = texto(i.config.domain);
    if (!dominioId) {
      // Sin el id no se puede preguntar por el dominio. Se comprueba al menos
      // que la llave sirva, y se dice claramente que falta el resto.
      const res = await pedir(i, 'https://api.resend.com/domains', {
        authorization: `Bearer ${i.secret}`,
        accept: 'application/json',
      });
      if ('fallo' in res) return res.fallo;
      if (!res.r.ok) return fallaHttp(res.r, res.cuerpo, i.secret);
      return {
        ok: false,
        reason: motivo([
          'La llave sirve, pero falta el ID del dominio para comprobar que esté verificado',
        ]),
        detail: { keyOk: true },
        externalAccountId: dominio || null,
      };
    }

    const res = await pedir(i, `https://api.resend.com/domains/${encodeURIComponent(dominioId)}`, {
      authorization: `Bearer ${i.secret}`,
      accept: 'application/json',
    });
    if ('fallo' in res) return res.fallo;
    if (!res.r.ok) return fallaHttp(res.r, res.cuerpo, i.secret);

    const cuerpo = (res.cuerpo ?? {}) as { id?: string; name?: string; status?: string };
    const estado = texto(cuerpo.status);
    // Que el dominio EXISTA no basta: sin SPF, DKIM y DMARC verificados el
    // correo se va a spam o rebota, y el emprendedor cree que está conectado.
    return {
      ok: estado === 'verified',
      reason:
        estado === 'verified'
          ? null
          : motivo([
              `El dominio ${texto(cuerpo.name) || dominio || ''} todavía no está verificado`,
              `estado '${estado || 'desconocido'}'`,
            ]),
      detail: { domain: texto(cuerpo.name) || dominio || null, status: estado || null },
      externalAccountId: texto(cuerpo.name) || dominio || null,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// El registro
// ════════════════════════════════════════════════════════════════════════════

export const PROVEEDORES: Record<string, ProveedorSpec> = {
  evolution: EVOLUTION,
  meta: META,
  twilio: TWILIO,
  resend: RESEND,
};

/**
 * La especificación de un proveedor, o `VALIDATION` diciendo cuáles hay.
 *
 * Se rechaza AL GUARDAR y no al usar: una credencial de un proveedor que nadie
 * sabe comprobar es una palomita verde que no significa nada, y descubrirlo
 * cuando el mensaje no salió es tardísimo.
 */
export function proveedor(nombre: string): ProveedorSpec {
  const spec = PROVEEDORES[nombre];
  if (!spec) {
    throw new PlatformError(
      'VALIDATION',
      `No conozco el proveedor '${nombre}'. Los que hay: ${Object.keys(PROVEEDORES).join(', ')}. ` +
        'Agregar uno es una entrada en packages/integrations/src/providers/catalogo.ts, con su ' +
        'comprobación real y su política de respaldo escrita.',
    );
  }
  return spec;
}

/** `true` si el respaldo de plataforma está permitido Y encendido. */
export function respaldoEncendido(spec: ProveedorSpec): boolean {
  if (!spec.respaldo.permitido) return false;
  return texto(process.env.INTEGRATIONS_PLATFORM_FALLBACK).toLowerCase() === 'true';
}
