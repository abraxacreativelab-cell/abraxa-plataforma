/**
 * ════════════════════════════════════════════════════════════════════════════
 *  IntegrationsPort — el contrato de las credenciales por empresa
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Escrito con las mismas tres reglas que `packages/db/ports.ts`:
 *
 *  1. SÓLO TIPOS. Ni una línea de implementación, ni una constante en runtime.
 *  2. Programa contra el port, no contra el paquete. H6 pide la credencial de
 *     Evolution de ESTA empresa sin conocer una sola tabla de aquí.
 *  3. Es de H17. Si te falta algo, anótalo en tu PR — no lo edites en tu rama.
 *
 *  ── Por qué este archivo no está en packages/db/ports.ts ───────────────────
 *
 *  Por lo mismo que `ContactsPort` de H15 (H15-crm.md §9.4): `packages/db/**`
 *  es de H1 y el gate falla cualquier PR que lo toque, y además `PortName` es
 *  `keyof PortRegistry` con `const OWNER: Record<PortName, string>` escrito a
 *  mano en `port-registry.ts:6`. Agregar una novena llave desde aquí rompería
 *  `npm run typecheck` en un archivo de otro carril.
 *
 *  El contrato vive aquí, se registra en el MISMO registro central de H1 (ver
 *  `port-registration.ts`) y se consume con `useIntegrations()`.
 *
 *  ── Cómo lo usan los carriles que lo esperan ───────────────────────────────
 *
 *      // H6 · packages/inbox — el driver de WhatsApp, que YA acepta que se
 *      // las pasen (evolution.ts:225-226, el `??=`)
 *      const cred = await useIntegrations().resolveFor(ctx, 'evolution');
 *      const driver = crearDriverEvolution({
 *        baseUrl: String(cred.config.baseUrl),
 *        apiKey: cred.secret,
 *      });
 *
 *      // H12 · el webhook de Meta, que llega con el id de página adentro
 *      const dueño = await useIntegrations().resolveTenantByExternalAccount({
 *        provider: 'meta', externalAccountId: entrada.entry[0].id,
 *      });
 *      if (!dueño) return;   // ignora y registra. NUNCA "el primero que haya".
 *
 *  En tus pruebas no me esperes: `registerIntegrationsPort(doble)` y sigue.
 */
import type { TenantContext } from '@abraxa/db';

// ════════════════════════════════════════════════════════════════════════════
// Vocabulario
// ════════════════════════════════════════════════════════════════════════════

/**
 * Estado de una credencial.
 *
 *   pending    capturada, todavía sin comprobar (o con el OAuth a medias)
 *   connected  comprobada contra el proveedor. Es lo único que resuelve.
 *   error      la comprobación falló. La fila NO se borra: revocar es del
 *              emprendedor, y borrar su credencial porque un token caducó le
 *              quita la única pista de qué pasó.
 *   revoked    la desconectó el emprendedor. Deja de rutear de inmediato.
 */
export type IntegrationStatus = 'pending' | 'connected' | 'error' | 'revoked';

/** De dónde salió la credencial que se está usando. Se registra en cada uso. */
export type IntegrationSource = 'tenant' | 'platform';

/**
 * Tipos de la bitácora. `string` abierto a propósito para no obligar a H12 y
 * H13 a esperar una migración mía por cada evento nuevo.
 */
export type IntegrationEventType =
  | 'connect'
  | 'verify_ok'
  | 'verify_fail'
  | 'rotate'
  | 'revoke'
  | 'refresh'
  | 'platform_fallback'
  | 'resolve_miss';

// ════════════════════════════════════════════════════════════════════════════
// Formas
// ════════════════════════════════════════════════════════════════════════════

/**
 * La integración TAL COMO SALE POR HTTP. Fíjate en lo que no está: el secreto.
 *
 * No hay un campo con el valor, ni cifrado ni truncado ni "sólo para el dueño".
 * Lo que hay es una HUELLA, que sirve para distinguir una credencial de otra
 * —"¿la que está puesta es la nueva o la vieja?"— sin poder usar ninguna.
 *
 * Es un tipo, no una promesa: la prueba que lo hace verdad serializa el objeto
 * completo y busca el texto claro (`src/no-filtra.test.ts`).
 */
export interface Integration {
  id: string;
  provider: string;
  label: string;
  /** La cuenta del lado del proveedor. `null` mientras el OAuth no termina. */
  externalAccountId: string | null;
  /** Lo que no es secreto: número, dominio, base URL, scopes. */
  config: Record<string, unknown>;
  status: IntegrationStatus;
  /** `••••4821 · a1b2c3d4` — cola visible y 8 hex del sha256. `null` si no hay secreto. */
  fingerprint: string | null;
  /** Motivo corto y saneado del último fallo. Nunca el cuerpo del proveedor. */
  lastError: string | null;
  /** Cuándo se comprobó que SIRVE. `null` = capturada pero nunca verificada. */
  verifiedAt: string | null;
  expiresAt: string | null;
  keyVersion: number;
  connectedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * La credencial resuelta, para usarla DENTRO del proceso.
 *
 * `secret` es el texto claro y por eso este objeto no cruza HTTP jamás: se lo
 * pasa el servicio al driver que va a hablar con el proveedor y muere ahí.
 */
export interface ResolvedIntegration {
  provider: string;
  config: Record<string, unknown>;
  /** El secreto en claro. Sólo existe dentro del proceso y nunca se serializa. */
  secret: string;
  /** De dónde salió. Se registra en cada uso. */
  source: IntegrationSource;
  /** `null` cuando viene del respaldo de plataforma: no hay fila que apuntar. */
  integrationId: string | null;
}

/** Resultado de una comprobación real contra el proveedor. */
export interface VerifyOutcome {
  ok: boolean;
  status: IntegrationStatus;
  /** Motivo corto y saneado cuando `ok === false`. */
  reason: string | null;
  /** Lo que el proveedor dijo de sí mismo y sí se puede guardar: id de cuenta,
   *  estado de la instancia, si el dominio está verificado. */
  detail: Record<string, unknown>;
  /** La cuenta externa que reportó el proveedor, si la reportó. */
  externalAccountId: string | null;
  verifiedAt: string | null;
}

export interface IntegrationEvent {
  id: string;
  integrationId: string | null;
  provider: string;
  type: IntegrationEventType | (string & Record<never, never>);
  detail: Record<string, unknown>;
  actor: string | null;
  createdAt: string;
}

/** Lo que la pantalla necesita saber de un proveedor sin preguntarle al código. */
export interface ProviderInfo {
  name: string;
  label: string;
  /** Qué se le pide al emprendedor, en su idioma. */
  secretLabel: string;
  /** Campos de `config` que la pantalla pinta como entradas de texto. */
  configFields: Array<{ key: string; label: string; required: boolean; placeholder?: string }>;
  /** ¿Puede caer al respaldo de plataforma? Y si no, por qué no. */
  fallbackAllowed: boolean;
  fallbackReason: string;
  /** `true` si el respaldo está permitido Y encendido en este despliegue. */
  fallbackActive: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// Entradas
// ════════════════════════════════════════════════════════════════════════════

export interface SaveIntegrationInput {
  provider: string;
  /** Cómo la llama el emprendedor. Ausente = el nombre del proveedor. */
  label?: string;
  /** El secreto EN CLARO. Se cifra antes de tocar la base y no se guarda de
   *  ninguna otra forma. Ausente en un `save` de reconfiguración deja el
   *  secreto que ya había. */
  secret?: string;
  config?: Record<string, unknown>;
  externalAccountId?: string | null;
  expiresAt?: string | null;
  actor?: string;
  /** Comprobar contra el proveedor antes de dar por buena la credencial.
   *  Por defecto `true`: capturado no es conectado. */
  verify?: boolean;
}

export interface ListIntegrationsInput {
  provider?: string;
  /** Por defecto las revocadas NO salen. */
  includeRevoked?: boolean;
}

export interface ExternalAccountRef {
  provider: string;
  externalAccountId: string;
}

// ════════════════════════════════════════════════════════════════════════════
// El port
// ════════════════════════════════════════════════════════════════════════════

export interface IntegrationsPort {
  // ── Lo que usan los drivers (H6, H12, H13) ───────────────────────────────

  /**
   * La credencial de ESTA empresa para ESTE proveedor.
   *
   * `opts.externalAccountId` elige UNA cuenta cuando la empresa tiene varias
   * del mismo proveedor —dos números de WhatsApp, dos páginas de Facebook—.
   * Sin él gana la comprobada más recientemente, que es lo correcto para el
   * caso común de una sola cuenta y lo único honesto cuando hay dos: pedirle
   * al llamador que diga cuál, en vez de elegir por él.
   *
   * Precedencia, y no es negociable:
   *
   *   1. `app.tenant_integrations` con `status='connected'` — siempre gana.
   *   2. El respaldo de plataforma (las variables de `.env`) — sólo si el
   *      proveedor lo permite Y está encendido. Apagado por defecto, e
   *      IMPOSIBLE de encender para `evolution`, `twilio` y `meta`: compartir
   *      instancia es compartir el número.
   *   3. `CHANNEL_ERROR` diciendo QUÉ conectar y DÓNDE. No "algo falló".
   *
   * Cuando devuelve `source: 'platform'`, lo registra en la bitácora. Un
   * respaldo silencioso es cómo se llega a producción con dos clientes en el
   * mismo número sin que nadie lo haya decidido.
   */
  resolveFor(
    ctx: TenantContext,
    provider: string,
    opts?: { externalAccountId?: string },
  ): Promise<ResolvedIntegration>;

  /** Igual, pero `null` en vez de lanzar. Para caminos best-effort. */
  tryResolveFor(
    ctx: TenantContext,
    provider: string,
    opts?: { externalAccountId?: string },
  ): Promise<ResolvedIntegration | null>;

  /**
   * Del identificador de la cuenta externa al tenant dueño. Sin él, un webhook
   * de Meta no sabe de quién es: una app de Meta tiene UN webhook para todas
   * las páginas que la autorizaron.
   *
   * **Devolver `null` es una respuesta válida y frecuente** — Meta manda
   * eventos de páginas que ya se desconectaron. `null` significa "ignora y
   * registra", NUNCA "usa el primero que encuentres".
   *
   * No recibe `TenantContext` porque su trabajo es justamente averiguar cuál
   * es: el índice único parcial de la migración 140 garantiza que la respuesta
   * sea una empresa o ninguna.
   */
  resolveTenantByExternalAccount(
    i: ExternalAccountRef,
  ): Promise<{ tenantId: string; integrationId: string } | null>;

  // ── Lo que usa la pantalla de Ajustes ────────────────────────────────────

  /** Las integraciones de la empresa. Con huella, nunca con secreto. */
  list(ctx: TenantContext, i?: ListIntegrationsInput): Promise<Integration[]>;

  /** Una, por id. `null` si no es de esta empresa — y ése es el punto. */
  get(ctx: TenantContext, integrationId: string): Promise<Integration | null>;

  /**
   * Conectar o reconectar. Cifra el secreto, guarda, y —salvo que le digan que
   * no— lo COMPRUEBA contra el proveedor antes de dejarlo en `connected`.
   *
   * Reconectar con la misma cuenta REEMPLAZA la fila, que invalida la
   * credencial anterior: es lo que uno quiere al reconectar.
   *
   * Lanza `CONFLICT` (23505) si esa cuenta externa ya está conectada en otra
   * empresa. Una misma página de Facebook no pertenece a dos negocios.
   */
  save(
    ctx: TenantContext,
    i: SaveIntegrationInput,
  ): Promise<{ integrationId: string; status: IntegrationStatus; verify: VerifyOutcome | null }>;

  /**
   * Comprueba contra el proveedor, de verdad: una llamada barata y de sólo
   * lectura. Al conectar, bajo demanda desde la pantalla, y en el repaso
   * periódico.
   *
   * Si falla, deja `status='error'` con su motivo y **no borra la fila**.
   */
  verify(ctx: TenantContext, integrationId: string): Promise<VerifyOutcome>;

  /** La desconecta. Queda en `revoked` y deja de rutear webhooks de inmediato. */
  revoke(ctx: TenantContext, integrationId: string, i?: { actor?: string }): Promise<void>;

  /** La bitácora de la empresa. Es lo que contesta "conecté y no funcionó". */
  events(
    ctx: TenantContext,
    i?: { integrationId?: string; limit?: number },
  ): Promise<IntegrationEvent[]>;

  /** El catálogo, con la política de respaldo de cada proveedor y su razón. */
  providers(): ProviderInfo[];
}
