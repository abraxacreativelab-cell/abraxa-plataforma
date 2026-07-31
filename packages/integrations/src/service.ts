/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El servicio: las credenciales de canal, por empresa
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Todo lo de aquí pasa por `tenantDb(ctx)`. No hay una sola llamada a
 *  `adminDb()` en este archivo: las dos tablas de H17 llevan `tenant_id` y
 *  ninguna es global — una credencial siempre es de alguien.
 *
 *  Los dos trabajos que legítimamente no caben en un tenant viven aparte y con
 *  su razón escrita: `src/routing.ts` (del webhook al dueño) y `src/sweep.ts`
 *  (el repaso periódico).
 */
import { PlatformError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { aHex } from './crypto/bytea';
import { cerrar, huella } from './crypto/secret-box';
import { leerEventos, registrar } from './events';
import type {
  ExternalAccountRef,
  Integration,
  IntegrationEvent,
  IntegrationStatus,
  IntegrationsPort,
  ListIntegrationsInput,
  ProviderInfo,
  ResolvedIntegration,
  SaveIntegrationInput,
  VerifyOutcome,
} from './port';
import { PROVEEDORES, proveedor, respaldoEncendido } from './providers/catalogo';
import type { ProveedorSpec } from './providers/catalogo';
import { motivo } from './providers/sanear';
import { buscarDueño } from './routing';
import {
  COLUMNAS,
  aIntegration,
  ahora,
  ataduraDe,
  db,
  esDuplicado,
  fallo,
  lista,
  secretoDe,
  una,
  type FilaIntegracion,
} from './store';

export interface OpcionesServicio {
  /** Se inyecta en las pruebas. En producción es el `fetch` de Node 22. */
  fetchImpl?: typeof fetch;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Qué le falta conectar al emprendedor, dicho para él y con la dirección
 * exacta de dónde se arregla.
 *
 * "Algo falló" manda a alguien a abrir un ticket. Esto lo manda a la pantalla
 * donde se resuelve en dos minutos, y es el criterio 12 de §11.
 */
function faltaConectar(spec: ProveedorSpec): PlatformError {
  return new PlatformError(
    'CHANNEL_ERROR',
    `Falta conectar ${spec.queEs}: no hay credencial de ${spec.label} para esta empresa. ` +
      'Se conecta en Ajustes → Integraciones (/ajustes/integraciones). ' +
      (spec.respaldo.permitido
        ? 'Mientras tanto se puede usar el respaldo de la plataforma, pero está apagado en este despliegue.'
        : `No hay respaldo de la plataforma para este canal: ${spec.respaldo.razon}`),
    { details: { provider: spec.name } },
  );
}

/**
 * Cada cuánto se vuelve a anotar que una empresa está usando el respaldo de
 * plataforma.
 *
 * `resolveFor()` se llama en CADA mensaje que sale, así que un evento por
 * llamada convertiría la bitácora en un log de tráfico y enterraría justo lo
 * que hay que ver ahí. Una vez por hora por (empresa, proveedor) es suficiente
 * para que el hecho sea visible y auditable —que es el requisito— sin volverlo
 * ruido. La pantalla no depende de esto: lee el estado, no la bitácora.
 */
const RESPALDO_CADA_MS = 60 * 60 * 1000;

export function createIntegrationsService(o: OpcionesServicio = {}): IntegrationsPort {
  const fetchImpl = o.fetchImpl ?? globalThis.fetch;

  /** Última vez que se anotó el respaldo, por `tenantId:proveedor`. Vive en el
   *  proceso: si se reinicia, se vuelve a anotar, que es el lado correcto en el
   *  que equivocarse. */
  const respaldoAnotado = new Map<string, number>();

  function tocaAnotarRespaldo(clave: string): boolean {
    const previo = respaldoAnotado.get(clave);
    const ahoraMs = Date.now();
    if (previo !== undefined && ahoraMs - previo < RESPALDO_CADA_MS) return false;
    // Tope de tamaño: un proceso longevo con miles de empresas no debe
    // acumular una entrada por cada una para siempre.
    if (respaldoAnotado.size > 5_000) respaldoAnotado.clear();
    respaldoAnotado.set(clave, ahoraMs);
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Lectura
  // ──────────────────────────────────────────────────────────────────────────

  async function filaPorId(ctx: TenantContext, id: string): Promise<FilaIntegracion | null> {
    // `tenantDb` pone el `.eq('tenant_id', …)`. Es lo que hace que pedir la
    // fila de OTRA empresa por su id devuelva null en vez de su credencial.
    const r = await db(ctx).from('tenant_integrations').select(COLUMNAS).eq('id', id).maybeSingle();
    return una<FilaIntegracion>(r, 'leer la integración');
  }

  async function filaPorCuenta(
    ctx: TenantContext,
    provider: string,
    externalAccountId: string | null,
  ): Promise<FilaIntegracion | null> {
    let q = db(ctx).from('tenant_integrations').select(COLUMNAS).eq('provider', provider);
    q = externalAccountId
      ? q.eq('external_account_id', externalAccountId)
      : q.is('external_account_id', null);
    const filas = lista<FilaIntegracion>(await q.limit(1), 'buscar la integración');
    return filas[0] ?? null;
  }

  async function exigirFila(ctx: TenantContext, id: string): Promise<FilaIntegracion> {
    const fila = await filaPorId(ctx, id);
    if (!fila) {
      // El mismo 404 para "no existe" y para "es de otra empresa". Distinguirlos
      // convertiría este endpoint en un oráculo que confirma qué ids existen en
      // el resto de la plataforma.
      throw new PlatformError('NOT_FOUND', 'No existe esa integración en esta empresa');
    }
    return fila;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Verificación
  // ──────────────────────────────────────────────────────────────────────────

  /** Comprueba contra el proveedor y ESCRIBE el resultado en la fila. */
  async function comprobarYGuardar(
    ctx: TenantContext,
    fila: FilaIntegracion,
    actor?: string,
  ): Promise<VerifyOutcome> {
    const spec = proveedor(fila.provider);
    const secreto = secretoDe(fila) ?? '';

    const resultado = await spec.verificar({
      secret: secreto,
      config: (fila.config ?? {}) as Record<string, unknown>,
      externalAccountId: fila.external_account_id,
      fetchImpl,
    });

    const cuando = ahora();
    const status: IntegrationStatus = resultado.ok ? 'connected' : 'error';

    const patch: Record<string, unknown> = {
      status,
      last_error: resultado.ok ? null : motivo([resultado.reason], [secreto]),
      updated_at: cuando,
    };
    if (resultado.ok) patch.verified_at = cuando;
    if (resultado.expiresAt !== undefined) patch.expires_at = resultado.expiresAt;

    // La cuenta externa que reportó el proveedor manda sobre la que se capturó:
    // es la que va a traer el webhook. Sólo se escribe si la fila no tenía una,
    // para que reconectar no mueva la llave del ruteo por sorpresa.
    if (resultado.externalAccountId && !fila.external_account_id) {
      patch.external_account_id = resultado.externalAccountId;
    }

    const r = await db(ctx).from('tenant_integrations').update(patch).eq('id', fila.id);
    if ((r as { error?: { code?: string; message: string } }).error) {
      const e = (r as { error: { code?: string; message: string } }).error;
      if (esDuplicado(e)) {
        // La cuenta que reportó el proveedor ya está conectada en otra empresa.
        // No es un error del emprendedor y no se puede arreglar reintentando:
        // se deja la fila en `error` diciéndolo, sin tocar el ruteo de nadie.
        const razon =
          'Esa cuenta ya está conectada en otra empresa. Una misma cuenta del proveedor no ' +
          'puede pertenecer a dos negocios.';
        await db(ctx)
          .from('tenant_integrations')
          .update({ status: 'error', last_error: razon, updated_at: cuando })
          .eq('id', fila.id);
        await registrar(ctx, {
          integrationId: fila.id,
          provider: fila.provider,
          type: 'verify_fail',
          detail: { conflict: true },
          actor,
        });
        return {
          ok: false,
          status: 'error',
          reason: razon,
          detail: { conflict: true },
          externalAccountId: resultado.externalAccountId,
          verifiedAt: fila.verified_at,
        };
      }
      throw fallo(e, 'guardar el resultado de la verificación');
    }

    await registrar(ctx, {
      integrationId: fila.id,
      provider: fila.provider,
      type: resultado.ok ? 'verify_ok' : 'verify_fail',
      detail: { ...resultado.detail, reason: resultado.reason ?? undefined },
      actor,
      secretos: [secreto],
    });

    return {
      ok: resultado.ok,
      status,
      reason: resultado.ok ? null : motivo([resultado.reason], [secreto]),
      detail: resultado.detail,
      externalAccountId: resultado.externalAccountId ?? fila.external_account_id,
      verifiedAt: resultado.ok ? cuando : fila.verified_at,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // El port
  // ──────────────────────────────────────────────────────────────────────────

  const servicio: IntegrationsPort = {
    async list(ctx: TenantContext, i: ListIntegrationsInput = {}): Promise<Integration[]> {
      let q = db(ctx).from('tenant_integrations').select(COLUMNAS);
      if (i.provider) q = q.eq('provider', i.provider);
      if (!i.includeRevoked) q = q.neq('status', 'revoked');
      const filas = lista<FilaIntegracion>(
        await q.order('created_at', { ascending: false }),
        'listar integraciones',
      );
      return filas.map(aIntegration);
    },

    async get(ctx: TenantContext, integrationId: string): Promise<Integration | null> {
      const fila = await filaPorId(ctx, integrationId);
      return fila ? aIntegration(fila) : null;
    },

    async save(ctx, i: SaveIntegrationInput) {
      const spec = proveedor(i.provider);
      const externalAccountId = texto(i.externalAccountId ?? '') || null;
      const cuando = ahora();

      const previa = await filaPorCuenta(ctx, spec.name, externalAccountId);

      // El secreto se cifra ANTES de tocar la base y no se guarda de ninguna
      // otra forma. Sin `INTEGRATIONS_KEY`, `cerrar()` lanza aquí — el
      // despliegue se cae en vez de escribir la credencial en claro.
      let cifrado: { ct: string; iv: string; tag: string; version: number } | null = null;
      if (i.secret !== undefined) {
        if (!texto(i.secret)) {
          throw new PlatformError('VALIDATION', 'La credencial no puede ir vacía.');
        }
        const sobre = cerrar(i.secret, ataduraDe(ctx.tenantId, spec.name));
        cifrado = {
          ct: aHex(sobre.ct),
          iv: aHex(sobre.iv),
          tag: aHex(sobre.tag),
          version: sobre.version,
        };
      } else if (!previa) {
        throw new PlatformError(
          'VALIDATION',
          `Falta la credencial de ${spec.label} (${spec.secretLabel}).`,
        );
      }

      const comun: Record<string, unknown> = {
        provider: spec.name,
        label: texto(i.label) || previa?.label || spec.label,
        external_account_id: externalAccountId,
        config: { ...(previa?.config ?? {}), ...(i.config ?? {}) },
        status: 'pending' satisfies IntegrationStatus,
        last_error: null,
        updated_at: cuando,
        // `connected_by` sale del contexto verificado y no del cuerpo: la
        // columna es FK a `app.users(email)` y un correo inventado por quien
        // llama reventaría la escritura o registraría a la persona equivocada.
        connected_by: ctx.userEmail ?? null,
      };
      if (i.expiresAt !== undefined) comun.expires_at = i.expiresAt;
      if (cifrado) {
        comun.secret_ct = cifrado.ct;
        comun.secret_iv = cifrado.iv;
        comun.secret_tag = cifrado.tag;
        comun.key_version = cifrado.version;
      }

      let id = previa?.id ?? '';
      if (previa) {
        const r = await db(ctx).from('tenant_integrations').update(comun).eq('id', previa.id);
        const e = (r as { error?: { code?: string; message: string } }).error;
        if (e) throw fallo(e, 'guardar la integración');
      } else {
        const r = await db(ctx)
          .from('tenant_integrations')
          .insert({ ...comun, created_at: cuando })
          .select(COLUMNAS);
        const e = (r as { error?: { code?: string; message: string } }).error;
        if (e) {
          // 23505 aquí sólo puede ser el índice único parcial de la 140: esa
          // cuenta externa ya está viva en OTRA empresa. `fallo()` lo traduce
          // a CONFLICT con el mensaje que lo explica.
          throw fallo(e, 'conectar la integración');
        }
        const filas = (r as { data: FilaIntegracion[] | null }).data ?? [];
        id = filas[0]?.id ?? '';
        if (!id) {
          const recien = await filaPorCuenta(ctx, spec.name, externalAccountId);
          id = recien?.id ?? '';
        }
      }

      await registrar(ctx, {
        integrationId: id,
        provider: spec.name,
        type: 'connect',
        detail: {
          label: String(comun.label),
          externalAccountId,
          fingerprint: i.secret ? huella(i.secret) : undefined,
          reconnect: Boolean(previa),
        },
        actor: i.actor,
        secretos: [i.secret],
      });

      if (i.verify === false) {
        return { integrationId: id, status: 'pending' as IntegrationStatus, verify: null };
      }

      const fila = await exigirFila(ctx, id);
      const resultado = await comprobarYGuardar(ctx, fila, i.actor);
      return { integrationId: id, status: resultado.status, verify: resultado };
    },

    async verify(ctx, integrationId): Promise<VerifyOutcome> {
      const fila = await exigirFila(ctx, integrationId);
      if (fila.status === 'revoked') {
        throw new PlatformError(
          'VALIDATION',
          'Esa integración está revocada. Vuelve a conectarla para poder comprobarla.',
        );
      }
      return comprobarYGuardar(ctx, fila);
    },

    async revoke(ctx, integrationId, i = {}): Promise<void> {
      const fila = await exigirFila(ctx, integrationId);

      // Se borra el ciphertext: una credencial revocada no tiene por qué
      // seguir descifrable en la base. La fila se queda —con su historia, su
      // etiqueta y su fecha— porque revocar no es olvidar.
      const r = await db(ctx)
        .from('tenant_integrations')
        .update({
          status: 'revoked',
          secret_ct: null,
          secret_iv: null,
          secret_tag: null,
          last_error: null,
          updated_at: ahora(),
        })
        .eq('id', fila.id);
      const e = (r as { error?: { code?: string; message: string } }).error;
      if (e) throw fallo(e, 'revocar la integración');

      await registrar(ctx, {
        integrationId: fila.id,
        provider: fila.provider,
        type: 'revoke',
        detail: { externalAccountId: fila.external_account_id },
        actor: i.actor,
      });
    },

    async resolveFor(ctx, provider, opts): Promise<ResolvedIntegration> {
      const resuelta = await servicio.tryResolveFor(ctx, provider, opts);
      if (!resuelta) throw faltaConectar(proveedor(provider));
      return resuelta;
    },

    async tryResolveFor(ctx, provider, opts): Promise<ResolvedIntegration | null> {
      const spec = proveedor(provider);

      // 1. La del tenant SIEMPRE gana.
      let q = db(ctx)
        .from('tenant_integrations')
        .select(COLUMNAS)
        .eq('provider', spec.name)
        .eq('status', 'connected');

      // Con varias cuentas del mismo proveedor —dos números de WhatsApp— el
      // llamador dice cuál. Sin eso, gana la comprobada más recientemente:
      // elegir en silencio entre dos números del mismo negocio es exactamente
      // la clase de decisión que no le toca a esta capa.
      if (opts?.externalAccountId) q = q.eq('external_account_id', opts.externalAccountId);

      const filas = lista<FilaIntegracion>(
        await q.order('verified_at', { ascending: false }).limit(1),
        'resolver la integración',
      );

      const fila = filas[0];
      if (fila) {
        const secreto = secretoDe(fila);
        if (secreto) {
          return {
            provider: spec.name,
            config: (fila.config ?? {}) as Record<string, unknown>,
            secret: secreto,
            source: 'tenant',
            integrationId: fila.id,
          };
        }
      }

      // 2. El respaldo de plataforma: apagado por defecto, e imposible de
      //    encender para evolution, twilio y meta (ver `catalogo.ts`).
      if (respaldoEncendido(spec)) {
        const delEntorno = spec.desdeEntorno?.() ?? null;
        if (delEntorno) {
          // Y se registra. Un respaldo silencioso es cómo se llega a producción
          // con dos clientes en la misma cuenta sin que nadie lo haya decidido.
          // Con freno de una hora, porque esto corre en cada mensaje que sale.
          if (tocaAnotarRespaldo(`${ctx.tenantId}:${spec.name}`)) {
            await registrar(ctx, {
              provider: spec.name,
              type: 'platform_fallback',
              detail: { reason: 'sin credencial propia conectada' },
            });
          }
          return {
            provider: spec.name,
            config: delEntorno.config,
            secret: delEntorno.secret,
            source: 'platform',
            integrationId: null,
          };
        }
      }

      return null;
    },

    resolveTenantByExternalAccount(i: ExternalAccountRef) {
      return buscarDueño(i);
    },

    events(ctx, i = {}): Promise<IntegrationEvent[]> {
      return leerEventos(ctx, i);
    },

    providers(): ProviderInfo[] {
      return Object.values(PROVEEDORES).map((spec) => ({
        name: spec.name,
        label: spec.label,
        secretLabel: spec.secretLabel,
        configFields: spec.configFields,
        fallbackAllowed: spec.respaldo.permitido,
        fallbackReason: spec.respaldo.razon,
        fallbackActive: respaldoEncendido(spec) && Boolean(spec.desdeEntorno?.()),
      }));
    },
  };

  return servicio;
}
