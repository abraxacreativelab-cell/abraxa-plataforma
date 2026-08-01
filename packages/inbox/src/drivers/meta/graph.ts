/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Cliente de la Graph API — lo único de aquí que habla con Meta.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El `fetch` se inyecta, igual que en el cliente de Evolution
 *  (`whatsapp/evolution.ts:17-23`) y por la misma razón: los criterios que hay
 *  que demostrar —la ventana de 24 h, la firma, el eco— se verifican aquí y
 *  ninguno debería necesitar una cuenta de Instagram conectada para correr en
 *  CI.
 *
 *  ── `appsecret_proof` ──────────────────────────────────────────────────────
 *
 *  Va en toda llamada donde haya App Secret. Es el HMAC-SHA256 del token de
 *  acceso con el secreto de la app, y prueba que quien usa el token también
 *  conoce el secreto. Meta lo exige cuando la app tiene activado *Require app
 *  secret*, y ahí el síntoma de no mandarlo es un 400 genérico. Mandarlo
 *  siempre cuesta un HMAC y ahorra ese diagnóstico.
 */
import { createHmac } from 'node:crypto';
import { PlatformError } from '@abraxa/db';
import { log } from '../../logger';
import { TIMEOUT_ADJUNTO_MS, TIMEOUT_META_MS, type ConfigMeta } from './ajustes';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpcionesCliente {
  fetchImpl?: FetchLike;
}

export interface RespuestaGraph<T = unknown> {
  status: number;
  data: T;
}

/** El error tal como lo devuelve Meta. */
export interface ErrorGraph {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

/** Etiquetas con las que Meta permite escribir FUERA de la ventana de 24 h. */
export type EtiquetaMensaje =
  | 'HUMAN_AGENT'
  | 'CONFIRMED_EVENT_UPDATE'
  | 'POST_PURCHASE_UPDATE'
  | 'ACCOUNT_UPDATE';

export interface EnvioTexto {
  destino: string;
  texto: string;
  etiqueta?: EtiquetaMensaje;
}

export interface EnvioAdjunto {
  destino: string;
  url: string;
  tipo: 'image' | 'video' | 'audio' | 'file';
  etiqueta?: EtiquetaMensaje;
}

export interface PerfilContacto {
  name: string | null;
  username: string | null;
}

export interface PaginaDeUsuario {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id?: string; username?: string } | null;
}

export interface ClienteMeta {
  enviarTexto(cfg: ConfigMeta, i: EnvioTexto): Promise<{ externalId: string | null }>;
  enviarAdjunto(cfg: ConfigMeta, i: EnvioAdjunto): Promise<{ externalId: string | null }>;
  perfil(cfg: ConfigMeta, id: string): Promise<PerfilContacto | null>;
  suscribirPagina(cfg: ConfigMeta, campos: string[]): Promise<void>;
  desuscribirPagina(cfg: ConfigMeta): Promise<void>;
  /** Datos de la página y la cuenta de Instagram que tenga vinculada. */
  infoPagina(cfg: ConfigMeta): Promise<{ id: string; name: string; igUserId: string | null }>;
  /** Código de OAuth → token de usuario de larga duración. */
  tokenDeUsuario(i: {
    baseUrl: string;
    apiVersion: string;
    appId: string;
    appSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<{ token: string; expiraEn: number | null }>;
  /** Las páginas que administra un usuario, con el token de cada una. */
  paginasDeUsuario(i: {
    baseUrl: string;
    apiVersion: string;
    appSecret: string;
    userToken: string;
  }): Promise<PaginaDeUsuario[]>;
}

// ════════════════════════════════════════════════════════════════════════════

export function createClienteMeta(opts: OpcionesCliente = {}): ClienteMeta {
  const pedir = async <T = unknown>(i: {
    method: 'GET' | 'POST' | 'DELETE';
    baseUrl: string;
    apiVersion: string;
    ruta: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
    appSecret?: string;
    accessToken?: string;
    timeoutMs?: number;
  }): Promise<RespuestaGraph<T>> => {
    const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new PlatformError('INTERNAL', 'No hay `fetch` en este runtime. Node 22 lo trae nativo.');
    }

    const url = new URL(`${i.baseUrl}/${i.apiVersion}${i.ruta}`);
    for (const [k, v] of Object.entries(i.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
    if (i.accessToken) {
      url.searchParams.set('access_token', i.accessToken);
      if (i.appSecret) {
        url.searchParams.set('appsecret_proof', pruebaDeSecreto(i.accessToken, i.appSecret));
      }
    }

    const timeoutMs = i.timeoutMs ?? TIMEOUT_META_MS;

    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        method: i.method,
        headers: { 'Content-Type': 'application/json' },
        body: i.body === undefined ? undefined : JSON.stringify(i.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // La misma distinción que aprendió el driver de WhatsApp, y que aquí pesa
      // igual: un timeout significa que la petición SÍ salió y pudo entregarse.
      // Reintentar a ciegas le manda al cliente el mismo DM dos veces.
      const nombre = (err as Error)?.name ?? 'Error';
      const expiro = nombre === 'TimeoutError' || nombre === 'AbortError';
      throw new PlatformError(
        'CHANNEL_ERROR',
        expiro
          ? `Meta no respondió en ${timeoutMs / 1000}s (envío ambiguo, no se reintenta)`
          : `Meta inalcanzable (${nombre})`,
        { retryable: !expiro, details: { ruta: i.ruta, timeout: expiro } },
      );
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* 204 y algunas rutas de baja responden vacío. No es un error. */
    }
    return { status: res.status, data: data as T };
  };

  const fallarSiHayError = (r: RespuestaGraph<{ error?: ErrorGraph }>, que: string): void => {
    const e = r.data?.error;
    if (r.status < 400 && !e) return;
    throw errorDeMeta(e, r.status, que);
  };

  return {
    async enviarTexto(cfg, { destino, texto, etiqueta }) {
      const r = await pedir<{ message_id?: string; error?: ErrorGraph }>({
        method: 'POST',
        baseUrl: cfg.baseUrl,
        apiVersion: cfg.apiVersion,
        ruta: `/${encodeURIComponent(idDeRuta(cfg))}/messages`,
        accessToken: cfg.pageAccessToken,
        appSecret: cfg.appSecret,
        body: {
          recipient: { id: destino },
          message: { text: texto },
          ...tipoDeEnvio(etiqueta),
        },
      });
      fallarSiHayError(r, 'Mensaje no enviado');
      return { externalId: r.data?.message_id ?? null };
    },

    async enviarAdjunto(cfg, { destino, url, tipo, etiqueta }) {
      const r = await pedir<{ message_id?: string; error?: ErrorGraph }>({
        method: 'POST',
        baseUrl: cfg.baseUrl,
        apiVersion: cfg.apiVersion,
        ruta: `/${encodeURIComponent(idDeRuta(cfg))}/messages`,
        accessToken: cfg.pageAccessToken,
        appSecret: cfg.appSecret,
        // Meta DESCARGA la URL antes de responder: por eso el timeout largo.
        timeoutMs: TIMEOUT_ADJUNTO_MS,
        body: {
          recipient: { id: destino },
          message: { attachment: { type: tipo, payload: { url, is_reusable: true } } },
          ...tipoDeEnvio(etiqueta),
        },
      });
      fallarSiHayError(r, 'Adjunto no enviado');
      return { externalId: r.data?.message_id ?? null };
    },

    /**
     * Nombre del contacto.
     *
     * Best-effort de verdad: devuelve `null` en vez de lanzar. Un webhook no se
     * puede caer porque el nombre de alguien no se pudo leer — el mensaje vale
     * mucho más que la etiqueta con la que se muestra. Los permisos de perfil
     * son de los últimos en aprobarse, así que este 403 va a ser común hasta
     * que la App Review termine.
     */
    async perfil(cfg, id) {
      try {
        const r = await pedir<{ name?: string; username?: string; error?: ErrorGraph }>({
          method: 'GET',
          baseUrl: cfg.baseUrl,
          apiVersion: cfg.apiVersion,
          ruta: `/${encodeURIComponent(id)}`,
          query: { fields: cfg.canal === 'instagram' ? 'name,username' : 'name' },
          accessToken: cfg.pageAccessToken,
          appSecret: cfg.appSecret,
        });
        if (r.status >= 400 || r.data?.error) return null;
        return { name: r.data?.name ?? null, username: r.data?.username ?? null };
      } catch {
        return null;
      }
    },

    /**
     * Suscribe la app a los eventos de la página.
     *
     * Sin esto, la app queda dada de alta y **no llega ni un mensaje**: la
     * suscripción del webhook en el panel es a nivel de app, pero cada página
     * tiene que suscribirse por separado. Es el segundo motivo más común de
     * «conecté todo y no pasa nada».
     */
    async suscribirPagina(cfg, campos) {
      const r = await pedir<{ success?: boolean; error?: ErrorGraph }>({
        method: 'POST',
        baseUrl: cfg.baseUrl,
        apiVersion: cfg.apiVersion,
        ruta: `/${encodeURIComponent(cfg.pageId)}/subscribed_apps`,
        query: { subscribed_fields: campos.join(',') },
        accessToken: cfg.pageAccessToken,
        appSecret: cfg.appSecret,
      });
      fallarSiHayError(r, 'La página no quedó suscrita a los webhooks');
    },

    async desuscribirPagina(cfg) {
      const r = await pedir<{ success?: boolean; error?: ErrorGraph }>({
        method: 'DELETE',
        baseUrl: cfg.baseUrl,
        apiVersion: cfg.apiVersion,
        ruta: `/${encodeURIComponent(cfg.pageId)}/subscribed_apps`,
        accessToken: cfg.pageAccessToken,
        appSecret: cfg.appSecret,
      });
      // La baja es best-effort: si la página ya no existe o el token caducó, la
      // fila se borra igual. Dejar un canal muerto en la bandeja porque Meta
      // dijo 400 es peor que una suscripción huérfana del lado de Meta.
      if (r.status >= 400) {
        log.warn(`meta: la baja de la suscripción de ${cfg.pageId} devolvió ${r.status}`);
      }
    },

    async infoPagina(cfg) {
      const r = await pedir<{
        id?: string;
        name?: string;
        instagram_business_account?: { id?: string };
        error?: ErrorGraph;
      }>({
        method: 'GET',
        baseUrl: cfg.baseUrl,
        apiVersion: cfg.apiVersion,
        ruta: `/${encodeURIComponent(cfg.pageId)}`,
        query: { fields: 'id,name,instagram_business_account' },
        accessToken: cfg.pageAccessToken,
        appSecret: cfg.appSecret,
      });
      fallarSiHayError(r, 'No se pudo leer la página');
      return {
        id: String(r.data?.id ?? cfg.pageId),
        name: String(r.data?.name ?? ''),
        igUserId: r.data?.instagram_business_account?.id ?? null,
      };
    },

    async tokenDeUsuario({ baseUrl, apiVersion, appId, appSecret, code, redirectUri }) {
      const corto = await pedir<{ access_token?: string; error?: ErrorGraph }>({
        method: 'GET',
        baseUrl,
        apiVersion,
        ruta: '/oauth/access_token',
        query: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
      });
      fallarSiHayError(corto, 'Meta rechazó el código de autorización');

      const breve = corto.data?.access_token;
      if (!breve) {
        throw new PlatformError('CHANNEL_ERROR', 'Meta no devolvió token de acceso.', {
          retryable: false,
        });
      }

      // El token corto dura una hora. Cambiarlo por el largo AQUÍ y no «luego»
      // es la diferencia entre una integración que sigue viva en dos meses y
      // una que se cae sola sin que nadie sepa por qué.
      const largo = await pedir<{ access_token?: string; expires_in?: number; error?: ErrorGraph }>({
        method: 'GET',
        baseUrl,
        apiVersion,
        ruta: '/oauth/access_token',
        query: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: breve,
        },
      });
      fallarSiHayError(largo, 'Meta no cambió el token corto por uno de larga duración');

      const expira = largo.data?.expires_in;
      return {
        token: String(largo.data?.access_token ?? breve),
        expiraEn: typeof expira === 'number' ? expira : null,
      };
    },

    async paginasDeUsuario({ baseUrl, apiVersion, appSecret, userToken }) {
      const r = await pedir<{ data?: PaginaDeUsuario[]; error?: ErrorGraph }>({
        method: 'GET',
        baseUrl,
        apiVersion,
        ruta: '/me/accounts',
        query: { fields: 'id,name,access_token,instagram_business_account{id,username}' },
        accessToken: userToken,
        appSecret,
      });
      fallarSiHayError(r, 'No se pudieron leer las páginas del usuario');
      const paginas = r.data?.data;
      return Array.isArray(paginas) ? paginas : [];
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Detalles
// ════════════════════════════════════════════════════════════════════════════

/**
 * A quién se le cuelga `/messages`.
 *
 * En Messenger es la página. En Instagram es la CUENTA DE INSTAGRAM, y usar el
 * id de la página devuelve un 400 que no explica cuál de los dos ids está mal.
 */
function idDeRuta(cfg: ConfigMeta): string {
  return cfg.canal === 'instagram' ? cfg.igUserId : cfg.pageId;
}

/**
 * `messaging_type` y `tag`.
 *
 * Sin etiqueta el envío es una RESPUESTA, y sólo vale dentro de la ventana de
 * 24 h. Con etiqueta es un `MESSAGE_TAG`, que es lo único que Meta deja mandar
 * fuera de ella. Ver `ventana.ts`.
 */
function tipoDeEnvio(etiqueta?: EtiquetaMensaje): Record<string, string> {
  if (!etiqueta) return { messaging_type: 'RESPONSE' };
  return { messaging_type: 'MESSAGE_TAG', tag: etiqueta };
}

export function pruebaDeSecreto(accessToken: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

/**
 * Códigos de Meta que hay que distinguir, porque el sistema reacciona distinto
 * a cada uno.
 *
 * `retryable` no es cosmético: el motor de H8 lo usa para decidir si pausa una
 * corrida o la mata, y H6 marca el mensaje como `failed` con este texto. Un 190
 * (token caducado) marcado como reintentable haría que el sistema reintentara
 * en bucle algo que no se va a arreglar solo.
 */
export const CODIGO_FUERA_DE_VENTANA = 10;
export const SUBCODIGO_FUERA_DE_VENTANA = 2018278;

export function errorDeMeta(e: ErrorGraph | undefined, status: number, que: string): PlatformError {
  const codigo = Number(e?.code ?? 0);
  const sub = Number(e?.error_subcode ?? 0);
  // `error_user_msg` es el texto que Meta escribió para enseñarle a un humano.
  // Cuando existe es mejor que el `message` técnico.
  const detalle = e?.error_user_msg ?? e?.message ?? `HTTP ${status}`;

  if (codigo === CODIGO_FUERA_DE_VENTANA && sub === SUBCODIGO_FUERA_DE_VENTANA) {
    return new PlatformError(
      'CHANNEL_ERROR',
      'Fuera de la ventana de 24 horas de Meta: sólo se puede escribir con una ' +
        'etiqueta de mensaje aprobada. Ver `ventana.ts`.',
      { retryable: false, details: { codigo, sub } },
    );
  }
  if (codigo === 190 || status === 401) {
    return new PlatformError(
      'CHANNEL_ERROR',
      'El token de página de Meta caducó o se revocó. Hay que volver a vincular la ' +
        'cuenta desde Ajustes.',
      { retryable: false, details: { codigo } },
    );
  }
  if (codigo === 613 || codigo === 4 || codigo === 17 || status === 429) {
    return new PlatformError('RATE_LIMITED', `Meta está limitando: ${detalle}`, {
      retryable: true,
      details: { codigo },
    });
  }
  if (codigo === 551 || codigo === 1545041) {
    return new PlatformError(
      'CHANNEL_ERROR',
      'La persona no está disponible: bloqueó la cuenta o borró la conversación.',
      { retryable: false, details: { codigo } },
    );
  }

  return new PlatformError('CHANNEL_ERROR', `${que}: ${detalle}`, {
    // Un 5xx del proveedor sí se reintenta; un 4xx es un problema nuestro.
    retryable: status >= 500,
    details: { status, codigo, ...(sub ? { sub } : {}), ...(e?.fbtrace_id ? { fbtrace_id: e.fbtrace_id } : {}) },
  });
}
