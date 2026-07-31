/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El contexto sintético — la frontera entre "no hay sesión" y "todo filtrado".
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Un `TenantContext` normal se arma con `TenancyPort.contextFor()` desde una
 *  sesión verificada. Un webhook no tiene sesión: lo dispara Evolution, no una
 *  persona. Pero SÍ tiene una empresa, y está escrita en la fila del canal que
 *  ya se resolvió y cuyo token ya se verificó.
 *
 *  Esto lo convierte en un contexto. Es explícito y está escrito a mano a
 *  propósito, porque es la clase de atajo que se vuelve un agujero cuando nadie
 *  lo mira:
 *
 *  ── `userEmail: null` ──────────────────────────────────────────────────────
 *  No hay persona. Un correo inventado aquí acabaría en `messages.author` y en
 *  el ledger, y alguien tendría que depurar por qué un usuario que no existe
 *  mandó mensajes a las 3 de la mañana.
 *
 *  ── `role: null` y `areas: {}` ─────────────────────────────────────────────
 *  Deny por defecto. Este contexto NO sirve para autorizar a nadie: sirve para
 *  ACOTAR a un tenant. Se usa para dos cosas y sólo dos —correr el agente del
 *  canal y escribir en la bandeja de ese mismo canal— y las dos leen `tenantId`
 *  y nada más (verificado: `ctx.` aparece 5 veces en `packages/agents/src`, y
 *  las 5 son `ctx.tenantId`).
 *
 *  Si algún día un port empieza a exigir `areas` para leer datos del tenant,
 *  este archivo es donde hay que ampliarlo — DELIBERADAMENTE, no dejando que
 *  `{}` se convierta en "sin datos del negocio" en silencio, que es como el
 *  agente terminaría contestando sin precios sin que nadie se enterara.
 *
 *  ── `tenantSlug` ───────────────────────────────────────────────────────────
 *  No está en la fila del canal (`app.channels` no lo guarda: duplicaría un
 *  dato que ya vive en `app.tenants` y que puede cambiar). Se puede pasar si
 *  quien llama lo tiene a la mano; sirve sólo para logs.
 */
import type { TenantContext } from '@abraxa/db';
import { PlatformError } from '@abraxa/db';

export interface FuenteDeContexto {
  tenant_id: string;
  /** Opcional y sólo informativo. */
  tenant_slug?: string | null;
}

/**
 * El contexto de una empresa a partir de la fila de uno de sus canales.
 *
 * Lanza si la fila no trae `tenant_id`: seguir adelante con un contexto sin
 * tenant significaría escribir filas huérfanas o —peor— que `tenantDb` reviente
 * a media ingesta dejando el hilo a medias.
 */
export function contextoDeCanal(canal: FuenteDeContexto): TenantContext {
  const tenantId = canal?.tenant_id;
  if (!tenantId || typeof tenantId !== 'string') {
    throw new PlatformError(
      'INTERNAL',
      'El canal no trae `tenant_id`. Sin él no hay contexto que construir y ' +
        'ningún dato de este webhook se puede escribir con seguridad.',
    );
  }

  return {
    tenantId,
    tenantSlug: canal.tenant_slug ?? '',
    userEmail: null,
    role: null,
    areas: {},
  };
}

/** `true` si este contexto lo fabricó un webhook y no una sesión de persona. */
export function esContextoDeCanal(ctx: TenantContext): boolean {
  return ctx.userEmail === null && ctx.role === null;
}
