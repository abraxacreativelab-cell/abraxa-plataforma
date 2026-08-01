/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La configuración de un canal de Meta, leída de un solo lugar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Un canal de Meta necesita cinco cosas para funcionar, y las cinco son
 *  distintas entre sí — confundirlas es la primera media tarde que se pierde:
 *
 *    · `page_id`         — la página de Facebook. Manda y recibe en Messenger.
 *    · `ig_user_id`      — la cuenta de Instagram vinculada a esa página. En
 *                          Instagram el destinatario del envío es ESTE id, no
 *                          el de la página.
 *    · `page_access_token` — el token con el que se envía. Es de la PÁGINA, no
 *                          del usuario, y sirve para los dos canales.
 *    · `app_secret`      — con el que se verifica `X-Hub-Signature-256`.
 *    · `verify_token`    — el que Meta devuelve en el GET de alta del webhook.
 *
 *  ── DÓNDE viven los secretos, y por qué ahí ────────────────────────────────
 *
 *  `sanearCanal()` (H6, `channels/service.ts:36-45`) es lo único que impide que
 *  la `config` de un canal salga cruda al navegador, y filtra por **lista de
 *  nombres exactos**:
 *
 *      const SECRETOS = ['webhook_token','api_key','apikey','token','secret','password'];
 *      if (!SECRETOS.includes(k.toLowerCase())) config[k] = v;
 *
 *  `page_access_token` NO está en esa lista. `app_secret` tampoco. Guardarlos
 *  como llaves de primer nivel los publicaría en `GET /inbox/channels` — un
 *  token de página con el que cualquiera lee y escribe los DMs del cliente.
 *
 *  Por eso todos los secretos de Meta viven ANIDADOS bajo la llave `secret`,
 *  que sí está en la lista y se elimina entera. No es un truco: es la única
 *  forma de estar a salvo sin editar un archivo de H6. Queda anotado en el
 *  README para que H6 lo sepa, y `ajustes.test.ts` lo comprueba contra el
 *  `sanearCanal` de verdad — si alguien alarga la lista o cambia el filtro, la
 *  prueba se cae aquí y no en producción.
 *
 *  ── Y por qué se acepta que te los pasen por parámetro ─────────────────────
 *
 *  Mientras las credenciales sean variables del proceso, DOS CLIENTES COMPARTEN
 *  LA MISMA CUENTA DE INSTAGRAM. Ése es el trabajo de H17 (integraciones por
 *  tenant), y este driver ya está listo para él: se lee primero la `config` del
 *  canal —que es por tenant— y sólo se cae al entorno si ahí no hay nada. Es el
 *  mismo orden que usa el driver de WhatsApp (`whatsapp/evolution.ts:221-227`),
 *  y el motivo de que H17 pueda enchufarse sin tocar una línea de aquí.
 */
import { PlatformError } from '@abraxa/db';
import type { ChannelType } from '@abraxa/db';

/** El `object` con el que Meta marca de dónde viene un webhook. */
export type ObjetoMeta = 'instagram' | 'page';

/** Los dos canales que atiende este driver. */
export type CanalMeta = Extract<ChannelType, 'instagram' | 'messenger'>;

/** Versión de la Graph API. Se fija a una y se sube a propósito, nunca sola. */
export const API_VERSION = 'v21.0';

export const BASE_GRAPH = 'https://graph.facebook.com';

/** Timeout de una llamada a Meta. Igual que el del canal de H6, y por lo mismo. */
export const TIMEOUT_META_MS = 8_000;

/** Subir un adjunto por URL tarda más: Meta lo descarga antes de responder. */
export const TIMEOUT_ADJUNTO_MS = 30_000;

/**
 * Tope de caracteres por mensaje, por canal.
 *
 * No es el mismo y no está documentado en el mismo sitio: Messenger acepta
 * 2000, Instagram 1000. Pasarse devuelve un 400 con un texto genérico
 * (`param message[text] must be at most N characters`) que no dice cuál de los
 * dos límites se rompió. Se parte en trozos antes de salir.
 */
export const LARGO_MAXIMO: Record<CanalMeta, number> = {
  messenger: 2_000,
  instagram: 1_000,
};

/** El `object` del webhook que le corresponde a cada canal. */
export const OBJETO_DE: Record<CanalMeta, ObjetoMeta> = {
  instagram: 'instagram',
  messenger: 'page',
};

/**
 * Config de un canal de Meta ya resuelta y validada.
 *
 * `pageAccessToken` y `appSecret` pueden venir vacíos: hay caminos legítimos
 * que no los necesitan (parsear un webhook de prueba, leer el estado de un
 * canal a medio conectar). Lo que NO se hace es tratar el vacío como válido a
 * la hora de firmar o enviar — eso lo comprueban `exigirToken()` y `firma.ts`.
 */
export interface ConfigMeta {
  canal: CanalMeta;
  objeto: ObjetoMeta;
  /** La página de Facebook. Presente en los dos canales. */
  pageId: string;
  /** La cuenta de Instagram vinculada. Sólo en `instagram`. */
  igUserId: string;
  /** El id que Meta pone en `entry[].id` para ESTE canal. La llave del guardia. */
  idDeEntrada: string;
  baseUrl: string;
  apiVersion: string;
  pageAccessToken: string;
  appSecret: string;
  appId: string;
  verifyToken: string;
  /**
   * `true` deja pasar un webhook SIN firma (no uno con firma inválida).
   *
   * Existe para el modo desarrollo, donde se dispara el webhook con `curl` sin
   * calcular el HMAC. Se avisa en el log CADA vez que se usa, a propósito: un
   * canal que dejó de verificar firmas tiene que doler a la vista en el log,
   * no esconderse en una fila de la base.
   */
  firmaOpcional: boolean;
  /** Buscar el nombre del contacto en la Graph API la primera vez que escribe. */
  resolverPerfil: boolean;
}

/** Lo que se guarda anidado bajo `config.secret`. */
interface SecretosMeta {
  page_access_token?: unknown;
  app_secret?: unknown;
  app_id?: unknown;
  verify_token?: unknown;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Lee la config de un canal de Meta.
 *
 * Orden de resolución, y es el que hace posible a H17: **la fila del canal
 * primero, el entorno después**. Una variable de proceso es un valor global; en
 * cuanto dos clientes conectan su propia cuenta, el global es el error.
 */
export function leerConfigMeta(canal: CanalMeta, config: Record<string, unknown>): ConfigMeta {
  const c = config ?? {};
  const secretos = (c.secret ?? {}) as SecretosMeta;
  const entorno = process.env;

  const pageId = texto(c.page_id);
  const igUserId = texto(c.ig_user_id);

  return {
    canal,
    objeto: OBJETO_DE[canal],
    pageId,
    igUserId,
    // El guardia anti-cruce compara contra ESTE id. En Instagram, `entry[].id`
    // es el id de la cuenta de IG; en Messenger, el de la página.
    idDeEntrada: canal === 'instagram' ? igUserId : pageId,
    baseUrl: (texto(c.base_url) || texto(entorno.META_GRAPH_URL) || BASE_GRAPH).replace(/\/+$/, ''),
    apiVersion: texto(c.api_version) || texto(entorno.META_API_VERSION) || API_VERSION,
    pageAccessToken: texto(secretos.page_access_token) || texto(entorno.META_PAGE_ACCESS_TOKEN),
    appSecret: texto(secretos.app_secret) || texto(entorno.META_APP_SECRET),
    appId: texto(secretos.app_id) || texto(entorno.META_APP_ID),
    verifyToken: texto(secretos.verify_token) || texto(entorno.META_VERIFY_TOKEN),
    firmaOpcional: c.meta_firma_opcional === true,
    resolverPerfil: c.meta_perfil !== false,
  };
}

/**
 * El token de página, o un error que dice exactamente qué falta.
 *
 * Se separa de `leerConfigMeta` porque no todos los caminos lo necesitan, y un
 * canal a medio conectar tiene que poder LEERSE sin reventar.
 */
export function exigirToken(cfg: ConfigMeta): string {
  if (!cfg.pageAccessToken) {
    throw new PlatformError(
      'CHANNEL_ERROR',
      `El canal de ${cfg.canal} no tiene token de página. Se obtiene al vincular la ` +
        'cuenta desde Ajustes (`conectarPagina()`); una fila insertada a mano no sirve.',
      { retryable: false },
    );
  }
  return cfg.pageAccessToken;
}

/** El id al que se le manda un mensaje: la cuenta de IG, o la página. */
export function idDeEnvio(cfg: ConfigMeta): string {
  const id = cfg.canal === 'instagram' ? cfg.igUserId : cfg.pageId;
  if (!id) {
    throw new PlatformError(
      'CHANNEL_ERROR',
      cfg.canal === 'instagram'
        ? 'El canal de Instagram no tiene `ig_user_id`. Es la cuenta de Instagram ' +
          'vinculada a la página, y NO es el id de la página: enviar con el de la ' +
          'página devuelve un 400 que no lo dice.'
        : 'El canal de Messenger no tiene `page_id`.',
      { retryable: false },
    );
  }
  return id;
}

/**
 * Mete los secretos en `config.secret` sin pisar lo que ya hubiera.
 *
 * Todo lo que escriba una credencial en la config de un canal pasa por aquí. Si
 * mañana alguien agrega un secreto nuevo y lo pone en la raíz, esta función es
 * la que lo hace evidente en la revisión.
 */
export function guardarSecretos(
  config: Record<string, unknown>,
  nuevos: Record<string, string | undefined>,
): Record<string, unknown> {
  const previos = (config.secret ?? {}) as Record<string, unknown>;
  const secret: Record<string, unknown> = { ...previos };
  for (const [k, v] of Object.entries(nuevos)) {
    if (typeof v === 'string' && v.length > 0) secret[k] = v;
  }
  return { ...config, secret };
}
