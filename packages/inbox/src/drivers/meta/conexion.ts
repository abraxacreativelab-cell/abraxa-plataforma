/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Vincular la cuenta — lo que hace el emprendedor desde Ajustes.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Conectar Instagram no es «pegar un token»: son cuatro pasos y saltarse
 *  cualquiera deja un canal que se ve conectado y no recibe nada.
 *
 *    1. **Autorizar.** El emprendedor entra al diálogo de Facebook y acepta los
 *       permisos. Vuelve con un `code`.
 *    2. **Canjear.** El `code` se cambia por un token de usuario, y ese por uno
 *       de LARGA duración. El corto dura una hora: quedarse con él es una
 *       integración que se muere sola esa misma tarde.
 *    3. **Elegir página.** Un usuario puede administrar varias. De cada una
 *       sale su token de página y la cuenta de Instagram que tenga vinculada.
 *    4. **Suscribir la página.** `POST /{page-id}/subscribed_apps`. Éste es el
 *       paso que todo el mundo olvida, y sin él **no llega ni un mensaje**: la
 *       URL del webhook se configura a nivel de app, pero cada página tiene que
 *       suscribirse por separado.
 *
 *  ── Qué es de este carril y qué no ─────────────────────────────────────────
 *
 *  Aquí está el lado servidor completo: las URLs, el canje, el listado y la
 *  suscripción. La PANTALLA es de otro dueño —`app/(app)/ajustes/integraciones`
 *  es de H17— y el guardado de credenciales por tenant también. Este archivo
 *  está escrito para que H17 lo llame y no tenga que saber nada de Meta.
 */
import { randomBytes } from 'node:crypto';
import { PlatformError } from '@abraxa/db';
import { log } from '../../logger';
import { API_VERSION, BASE_GRAPH, guardarSecretos, type CanalMeta } from './ajustes';
import { idYaConectado } from './enrutado';
import type { ClienteMeta, PaginaDeUsuario } from './graph';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El `redirect_uri`, decidido por H0 y ya registrado en Meta (2026-07-31).
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La pantalla que lo atiende es de **H17** (`app/(app)/ajustes/integraciones`);
 *  aquí sólo vive el valor, porque tiene que ser **exactamente el mismo** en dos
 *  llamadas distintas y separadas en el tiempo:
 *
 *    1. el diálogo de autorización  (`urlDeAutorizacion`)
 *    2. el canje del código          (`cuentasVinculables` → `/oauth/access_token`)
 *
 *  Meta compara las dos cadenas **carácter por carácter** contra la que tiene
 *  registrada. Una barra final de más, `http` en vez de `https` o un parámetro
 *  de query cualquiera y el canje falla con
 *  `redirect_uri isn't an absolute URI` o con un genérico
 *  «Invalid verification code format», que no menciona el `redirect_uri` por
 *  ningún lado. Es el fallo más caro de depurar de todo el flujo, y la razón de
 *  que el valor esté en UNA constante y no en dos llamadores.
 */
export const REDIRECT_URI = 'https://mi.abraxa.club/ajustes/integraciones/meta/callback';

/** El `redirect_uri` efectivo. `META_REDIRECT_URI` lo pisa para desarrollo. */
export function redirectUriPorDefecto(): string {
  const v = String(process.env.META_REDIRECT_URI ?? '').trim();
  return v || REDIRECT_URI;
}

/**
 * Las credenciales de la app de Meta.
 *
 * Del entorno HOY (`META_APP_ID` / `META_APP_SECRET`, que H0 ya puso). Cuando
 * llegue H17 serán por tenant y sólo hay que pasarlas por parámetro: todo lo de
 * aquí las acepta, y este respaldo es el último recurso. Ver `ajustes.ts`.
 */
export function credencialesDeApp(i: { appId?: string; appSecret?: string } = {}): {
  appId: string;
  appSecret: string;
} {
  return {
    appId: i.appId || String(process.env.META_APP_ID ?? '').trim(),
    appSecret: i.appSecret || String(process.env.META_APP_SECRET ?? '').trim(),
  };
}

/**
 * Los permisos que se piden, por canal.
 *
 * Se piden los MÍNIMOS. Cada permiso extra alarga la App Review y le enseña al
 * emprendedor una pantalla de consentimiento más larga, que es donde la gente
 * se arrepiente. `pages_show_list` es imprescindible incluso para Instagram: la
 * cuenta de IG se alcanza a través de la página que la tiene vinculada.
 */
export const PERMISOS: Record<CanalMeta, readonly string[]> = {
  messenger: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'],
  instagram: [
    'pages_show_list',
    'pages_manage_metadata',
    'instagram_basic',
    'instagram_manage_messages',
  ],
};

/**
 * Los eventos a los que se suscribe la página.
 *
 * `message_echoes` está a propósito, y es la decisión menos obvia del archivo:
 * sin él no llegaría el eco de lo que el emprendedor contesta **desde su propio
 * teléfono**, y la IA seguiría hablando encima de él. Con él, ese caso funciona
 * y el eco de lo que mandamos nosotros lo filtra `ecos.ts`. La alternativa
 * —no suscribirse y ahorrarse el filtro— rompe el caso que más importa.
 */
export const EVENTOS: Record<CanalMeta, readonly string[]> = {
  messenger: [
    'messages',
    'messaging_postbacks',
    'message_deliveries',
    'message_reads',
    'message_echoes',
  ],
  instagram: ['messages', 'messaging_postbacks', 'message_reactions', 'messaging_seen'],
};

/**
 * El diálogo de autorización de Facebook.
 *
 * `state` es obligatorio y no es decorativo: es lo único que impide que alguien
 * le haga completar a un usuario un flujo de OAuth que él no empezó (CSRF). Lo
 * genera quien abre el diálogo y lo comprueba al volver.
 */
export function urlDeAutorizacion(i: {
  canal: CanalMeta;
  state: string;
  /** Por defecto, `META_APP_ID`. H17 lo pasará por tenant. */
  appId?: string;
  /** Por defecto, el registrado en Meta. Tiene que coincidir con el del canje. */
  redirectUri?: string;
  baseUrl?: string;
  apiVersion?: string;
}): string {
  const { appId } = credencialesDeApp({ ...(i.appId ? { appId: i.appId } : {}) });
  if (!appId) {
    throw new PlatformError(
      'CHANNEL_ERROR',
      'Falta el App ID de Meta. Está en el entorno como `META_APP_ID`; si el despliegue ' +
        'lo perdió, se lo pide H0 (la app "Abraxa platform").',
      { retryable: false },
    );
  }
  if (!i.state) {
    throw new PlatformError(
      'VALIDATION',
      'El flujo de OAuth necesita un `state`. Sin él, un tercero puede hacerle ' +
        'completar la vinculación a un usuario que nunca la empezó.',
    );
  }

  const base = (i.baseUrl ?? 'https://www.facebook.com').replace(/\/+$/, '');
  const url = new URL(`${base}/${i.apiVersion ?? API_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', i.redirectUri ?? redirectUriPorDefecto());
  url.searchParams.set('state', i.state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', PERMISOS[i.canal].join(','));
  return url.toString();
}

export interface CuentaVinculable {
  pageId: string;
  pageName: string;
  igUserId: string | null;
  igUsername: string | null;
  /** El token de ESTA página. Nunca sale al navegador. */
  pageAccessToken: string;
  /** `false` si la cuenta no sirve para el canal que se está conectando. */
  utilizable: boolean;
  /** Por qué no sirve, en español, para poder enseñarlo. */
  motivo?: string;
}

/**
 * Las cuentas que el emprendedor puede conectar, a partir del `code` de OAuth.
 *
 * Devuelve TODAS las páginas, incluidas las que no sirven, con el motivo
 * escrito. Enseñar sólo las utilizables deja al emprendedor mirando una lista
 * vacía sin saber que le falta vincular su Instagram a la página — que es el
 * caso más común y el que más soporte genera.
 */
export async function cuentasVinculables(
  cliente: ClienteMeta,
  i: {
    canal: CanalMeta;
    /** El `code` que Meta devolvió al `redirect_uri`. Lo recoge H17. */
    code: string;
    appId?: string;
    appSecret?: string;
    /** DEBE ser el mismo que se usó al abrir el diálogo. Ver `REDIRECT_URI`. */
    redirectUri?: string;
    baseUrl?: string;
    apiVersion?: string;
  },
): Promise<CuentaVinculable[]> {
  const baseUrl = (i.baseUrl ?? BASE_GRAPH).replace(/\/+$/, '');
  const apiVersion = i.apiVersion ?? API_VERSION;
  const { appId, appSecret } = credencialesDeApp({
    ...(i.appId ? { appId: i.appId } : {}),
    ...(i.appSecret ? { appSecret: i.appSecret } : {}),
  });

  if (!appId || !appSecret) {
    throw new PlatformError(
      'CHANNEL_ERROR',
      'Faltan las credenciales de la app de Meta (`META_APP_ID` / `META_APP_SECRET`).',
      { retryable: false },
    );
  }

  const { token } = await cliente.tokenDeUsuario({
    baseUrl,
    apiVersion,
    appId,
    appSecret,
    code: i.code,
    // El mismo valor que en el diálogo, y por eso sale de la misma función:
    // Meta las compara carácter por carácter y el error no lo menciona.
    redirectUri: i.redirectUri ?? redirectUriPorDefecto(),
  });

  const paginas = await cliente.paginasDeUsuario({
    baseUrl,
    apiVersion,
    appSecret,
    userToken: token,
  });

  return paginas.map((p) => describir(p, i.canal));
}

function describir(p: PaginaDeUsuario, canal: CanalMeta): CuentaVinculable {
  const igUserId = p.instagram_business_account?.id ?? null;
  const base = {
    pageId: String(p.id ?? ''),
    pageName: String(p.name ?? ''),
    igUserId,
    igUsername: p.instagram_business_account?.username ?? null,
    pageAccessToken: String(p.access_token ?? ''),
  };

  if (!base.pageAccessToken) {
    return {
      ...base,
      utilizable: false,
      motivo:
        'Meta no entregó el token de esta página. Suele ser que quien autorizó no es ' +
        'administrador de ella.',
    };
  }
  if (canal === 'instagram' && !igUserId) {
    return {
      ...base,
      utilizable: false,
      motivo:
        'Esta página no tiene una cuenta de Instagram profesional vinculada. Se vincula ' +
        'desde la configuración de la página de Facebook, y sin eso Instagram no entrega ' +
        'los mensajes.',
    };
  }
  return { ...base, utilizable: true };
}

export interface ResultadoConexion {
  config: Record<string, unknown>;
  externalId: string;
  status: 'active';
}

/**
 * Deja la cuenta lista: suscribe la página y devuelve la `config` del canal.
 *
 * Lo que NO hace es escribir la fila: eso es de `crearCanal()` / `ajustarCanal()`
 * de H6, que ya sabe hacerlo y ya valida lo suyo. Aquí sólo se construye la
 * config y se habla con Meta.
 */
export async function conectarCuenta(
  cliente: ClienteMeta,
  i: {
    canal: CanalMeta;
    cuenta: CuentaVinculable;
    appId: string;
    appSecret: string;
    /** Config previa del canal, si se está reconectando. */
    config?: Record<string, unknown>;
    baseUrl?: string;
    apiVersion?: string;
    canalId?: string;
  },
): Promise<ResultadoConexion> {
  if (!i.cuenta.utilizable) {
    throw new PlatformError(
      'VALIDATION',
      i.cuenta.motivo ?? 'Esa cuenta no se puede conectar a este canal.',
    );
  }

  // Antes de nada: que no la tenga ya otra empresa. Ver `enrutado.ts` — el
  // segundo en conectarla se quedaría con un canal mudo y sin explicación.
  const repetida = await idYaConectado({
    pageId: i.cuenta.pageId,
    ...(i.cuenta.igUserId ? { igUserId: i.cuenta.igUserId } : {}),
    ...(i.canalId ? { excluirCanalId: i.canalId } : {}),
  });
  if (repetida) {
    throw new PlatformError(
      'CONFLICT',
      'Esa cuenta de Meta ya está conectada en la plataforma. Una misma página o cuenta ' +
        'de Instagram no puede atender a dos empresas: los mensajes de una acabarían en ' +
        'la bandeja de la otra. Desconéctala donde esté antes de volver a conectarla.',
      { retryable: false },
    );
  }

  const config = configDeCanal({
    canal: i.canal,
    cuenta: i.cuenta,
    appId: i.appId,
    appSecret: i.appSecret,
    previa: i.config ?? {},
    ...(i.baseUrl ? { baseUrl: i.baseUrl } : {}),
    ...(i.apiVersion ? { apiVersion: i.apiVersion } : {}),
  });

  await cliente.suscribirPagina(
    {
      canal: i.canal,
      objeto: i.canal === 'instagram' ? 'instagram' : 'page',
      pageId: i.cuenta.pageId,
      igUserId: i.cuenta.igUserId ?? '',
      idDeEntrada: i.canal === 'instagram' ? (i.cuenta.igUserId ?? '') : i.cuenta.pageId,
      baseUrl: (i.baseUrl ?? BASE_GRAPH).replace(/\/+$/, ''),
      apiVersion: i.apiVersion ?? API_VERSION,
      pageAccessToken: i.cuenta.pageAccessToken,
      appSecret: i.appSecret,
      appId: i.appId,
      verifyToken: '',
      firmaOpcional: false,
      resolverPerfil: true,
    },
    [...EVENTOS[i.canal]],
  );

  log.info(
    `meta: ${i.canal} conectado a la página ${i.cuenta.pageName} (${i.cuenta.pageId})` +
      (i.cuenta.igUserId ? ` · IG ${i.cuenta.igUserId}` : ''),
  );

  return {
    config,
    // La dirección propia de la línea, que es lo que guarda `channels.external_id`.
    externalId: i.canal === 'instagram' ? (i.cuenta.igUserId ?? '') : i.cuenta.pageId,
    status: 'active',
  };
}

/**
 * La `config` de un canal de Meta.
 *
 * Los secretos van ANIDADOS bajo `secret` — ver la cabecera de `ajustes.ts`. Es
 * lo único que impide que `sanearCanal()` los deje pasar al navegador.
 */
export function configDeCanal(i: {
  canal: CanalMeta;
  cuenta: CuentaVinculable;
  appId: string;
  appSecret: string;
  previa: Record<string, unknown>;
  baseUrl?: string;
  apiVersion?: string;
}): Record<string, unknown> {
  const previa = i.previa ?? {};

  const base: Record<string, unknown> = {
    ...previa,
    page_id: i.cuenta.pageId,
    ...(i.cuenta.igUserId ? { ig_user_id: i.cuenta.igUserId } : {}),
    ...(i.cuenta.igUsername ? { ig_username: i.cuenta.igUsername } : {}),
    page_name: i.cuenta.pageName,
    ...(i.baseUrl ? { base_url: i.baseUrl } : {}),
    ...(i.apiVersion ? { api_version: i.apiVersion } : {}),
    // El token de la URL del webhook. Es de H6 y va en la raíz porque su
    // `resolverCanalDeWebhook()` lo lee de ahí; está en la lista de secretos de
    // `sanearCanal`, así que no sale al navegador.
    webhook_token: textoO(previa.webhook_token, () => randomBytes(24).toString('hex')),
  };

  return guardarSecretos(base, {
    page_access_token: i.cuenta.pageAccessToken,
    app_id: i.appId,
    app_secret: i.appSecret,
    verify_token: textoO(secretoPrevio(previa, 'verify_token'), () =>
      randomBytes(24).toString('hex'),
    ),
  });
}

function secretoPrevio(config: Record<string, unknown>, llave: string): unknown {
  return (config.secret as Record<string, unknown> | undefined)?.[llave];
}

function textoO(v: unknown, generar: () => string): string {
  return typeof v === 'string' && v.length > 0 ? v : generar();
}
