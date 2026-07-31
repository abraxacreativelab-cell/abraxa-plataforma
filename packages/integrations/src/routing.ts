/**
 * ════════════════════════════════════════════════════════════════════════════
 *  RUTEO INVERSO: del webhook al tenant dueño
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── Por qué este archivo usa `adminDb()` ───────────────────────────────────
 *
 *  Porque su trabajo es AVERIGUAR de qué empresa es un mensaje. No hay un
 *  `TenantContext` que pasarle: preguntarlo acotado a un tenant sería suponer
 *  la respuesta.
 *
 *  H6 no tiene este problema: resuelve el tenant por la URL del webhook
 *  (`/inbox/webhooks/:channelId?token=…`) porque cada canal tiene la suya.
 *  **Meta sí lo tiene**: una app de Meta tiene UN webhook para todas las
 *  páginas que la autorizaron, y el mensaje llega con el id de la página
 *  adentro.
 *
 *  Lo que hace que esto sea seguro y no un agujero:
 *
 *   1. La consulta filtra por `(provider, external_account_id)` EXACTOS y por
 *      `status <> 'revoked'`. No hay búsqueda parcial, ni `ilike`, ni orden
 *      por conveniencia.
 *   2. El índice único parcial de la migración 140 garantiza que la respuesta
 *      sea UNA empresa o ninguna. No hay "la primera que aparezca".
 *   3. Devuelve `{tenantId, integrationId}` y NADA MÁS. Ni el secreto, ni la
 *      configuración, ni el nombre de la empresa. Quien llama toma ese
 *      `tenantId`, arma su contexto y vuelve al carril aislado.
 *   4. `null` es una respuesta normal y frecuente, no un error: Meta manda
 *      eventos de páginas que ya se desconectaron. `null` significa "ignora y
 *      registra", nunca "usa el primero que encuentres".
 */
// `adminDb()` — y la razón escrita, como pide CONTRIBUTING.md: este archivo es
// el caso que la propia función documenta ("trabajo legítimo que no puede estar
// aislado por tenant"). Es una de las dos únicas consultas sin contexto del
// paquete —la otra es el repaso de `sweep.ts`—, devuelve sólo identificadores y
// no toca ni el secreto ni la configuración de nadie.
import { adminDb } from '@abraxa/db';
import type { ExternalAccountRef } from './port';

interface FilaDueño {
  id: string;
  tenant_id: string;
}

export async function buscarDueño(
  i: ExternalAccountRef,
): Promise<{ tenantId: string; integrationId: string } | null> {
  const cuenta = typeof i.externalAccountId === 'string' ? i.externalAccountId.trim() : '';
  const proveedor = typeof i.provider === 'string' ? i.provider.trim() : '';
  // Una cuenta vacía no se busca: `.eq('external_account_id', '')` traería las
  // filas con cadena vacía, que es justo el tipo de coincidencia accidental que
  // le entregaría los mensajes de un negocio a otro.
  if (!cuenta || !proveedor) return null;

  const { data, error } = await adminDb()
    .from('tenant_integrations')
    .select('id,tenant_id')
    .eq('provider', proveedor)
    .eq('external_account_id', cuenta)
    .neq('status', 'revoked')
    .limit(2);

  if (error) {
    // Fail-closed: si la base no contesta, NO se adivina un dueño. Un webhook
    // perdido se puede reintentar; uno entregado a la empresa equivocada, no.
    console.error('[integrations] no se pudo resolver el dueño de un webhook', {
      provider: proveedor,
      code: (error as { code?: string }).code ?? null,
    });
    return null;
  }

  const filas = (data ?? []) as FilaDueño[];

  if (filas.length > 1) {
    // No puede pasar: lo impide el índice único parcial de la 140. Si pasara,
    // significa que el índice no está aplicado, y elegir una de las dos sería
    // exactamente el fallo que este carril viene a cerrar.
    console.error('[integrations] dos empresas para la misma cuenta externa; no se entrega', {
      provider: proveedor,
      externalAccountId: cuenta,
    });
    return null;
  }

  const fila = filas[0];
  if (!fila) {
    // "Ignora y REGISTRA". Sin tenant no hay fila que escribir en
    // `integration_events` —está aislada por tenant—, así que el rastro va a la
    // consola del proceso. El día que a alguien no le lleguen sus mensajes,
    // esta línea es la que dice que llegaron y se ignoraron.
    console.warn('[integrations] webhook de una cuenta que nadie tiene conectada; se ignora', {
      provider: proveedor,
      externalAccountId: cuenta,
    });
    return null;
  }

  return { tenantId: fila.tenant_id, integrationId: fila.id };
}
