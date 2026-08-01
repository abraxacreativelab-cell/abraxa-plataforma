/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La entrega — todo lo que el Ritual deja sembrado al cerrar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Handoff §7. Cinco salidas, cada una a su dueño:
 *
 *    tenants.industry_type   → aquí abajo (app.tenants, con adminDb y su razón)
 *    tenant_areas[]          → blueprint + BlueprintSink   (ver ports/)
 *    tenant_milestones[]     → blueprint + BlueprintSink   (ver ports/)
 *    valores canónicos       → VaultPort, en BORRADOR
 *    documento madre         → VaultPort
 *
 *  ── Todo lo de aquí es BEST EFFORT ────────────────────────────────────────
 *
 *  Ninguna de estas escrituras puede tumbar el último turno del Ritual. Ese
 *  turno es el Mapa de Negocio: el pago de 20 minutos de preguntas. Que la
 *  bóveda esté caída no puede convertirse en "algo salió mal, intenta de
 *  nuevo" en la única pantalla que tenía que salir perfecta.
 *
 *  Lo que sí es obligatorio —guardar el blueprint— pasa antes y fuera de aquí.
 */
// `adminDb` y no `tenantDb`: `app.tenants` se filtra por `id`, que ES su llave
// de aislamiento; no tiene columna `tenant_id` por la que acotar. Es el mismo
// caso y el mismo comentario que packages/agents/src/prompt/compose.ts, y el
// `.eq('id', ctx.tenantId)` de abajo es lo que mantiene el aislamiento.
import { adminDb, tryPort, usePort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { PROMPT_MAESTRO_BASE } from '../interview/guion';
import { log } from '../logger';
import { marcarDocumentoMadre } from './blueprint';
import type { BlueprintGuardado, EstadoNegocio, MapaDeNegocio } from '../types';

// ════════════════════════════════════════════════════════════════════════════
// El giro
// ════════════════════════════════════════════════════════════════════════════

/**
 * Escribe el giro detectado en `tenants.industry_type`.
 *
 * Lo pide el §7 del handoff y no hay método en `TenancyPort` para hacerlo — se
 * propone `setIndustry(ctx, industryType)` en el PR. Mientras tanto se escribe
 * directo, acotado por `id = ctx.tenantId`: nunca puede tocar otra empresa.
 *
 * `mapa.industryType` YA viene resuelto contra `app.industry_templates` (ver
 * `synthesis/industria.ts`): o es el id de una plantilla que existe, o es
 * `null`. Aquí no se normaliza nada ni se inventa un slug de respaldo — esta
 * función escribe lo que el catálogo reconoció, y si no reconoció nada, no
 * toca la columna. La 033 dice que esa columna apunta a una fila; escribir algo
 * que no lo hace es peor que dejarla vacía, porque se ve igual de válida.
 *
 * También se guarda `stage` porque la columna existe desde la migración 001 y
 * el prompt de H3 la lee para darle contexto al agente en cada mensaje
 * (compose.ts). Dejarla vacía teniendo el dato sería tirarlo.
 */
export async function sembrarGiro(
  ctx: TenantContext,
  mapa: MapaDeNegocio,
  estado: EstadoNegocio,
): Promise<void> {
  if (!mapa.industryType && !estado.etapa) return;

  const patch: Record<string, unknown> = {};
  if (mapa.industryType) patch.industry_type = mapa.industryType;
  if (estado.etapa) patch.stage = estado.etapa;

  try {
    const { error } = await adminDb().from('tenants').update(patch).eq('id', ctx.tenantId);
    if (error) throw error;
    log.info(`giro del tenant fijado: ${mapa.industryType ?? '(sin giro)'}`);
  } catch (err) {
    log.warn(`no se pudo fijar el giro del tenant: ${String(err)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// La bóveda
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los valores canónicos que salieron de la fase 2, en el formato que la bóveda
 * entiende.
 *
 * Se mandan como TEXTO dentro del documento, no como una lista aparte, porque
 * `VaultPort.ingestDocument()` es quien extrae y clasifica —ésa es su
 * responsabilidad, no la mía— y entra todo en BORRADOR (`active = false`).
 * Nada se activa solo: eso es gobernanza de la bóveda y el Ritual no la salta
 * por ir rápido.
 */
function bloqueDeValores(e: EstadoNegocio): string {
  const filas = [
    e.ticket ? `- ticket_promedio: ${e.ticket}` : null,
    e.margen ? `- margen_aprox: ${e.margen}` : null,
    e.modeloIngreso ? `- modelo_ingreso: ${e.modeloIngreso}` : null,
    e.giro ? `- giro: ${e.giro}` : null,
    e.nicho ? `- cliente_objetivo: ${e.nicho}` : null,
    (e.canales?.length ?? 0) > 0 ? `- canales: ${(e.canales ?? []).join(', ')}` : null,
  ].filter((x): x is string => x !== null);

  if (filas.length === 0) return '';

  return `\n\n## Valores del negocio (borrador — pendientes de tu aprobación)\n\n${filas.join('\n')}\n`;
}

/**
 * Manda el documento madre a la bóveda. Una sola vez por Ritual.
 *
 * `tryPort` y no `usePort`: si H4 todavía no aterriza, el Ritual termina igual
 * y el documento queda en `app.onboarding_blueprints.summary`, de donde se
 * puede reenviar después. Es la regla 5 aplicada a un camino opcional.
 *
 * ── La llave de idempotencia, y dónde tuvo que vivir (auditoría PR #8) ────
 *
 * Ésta es la escritura más peligrosa del cierre, y lo es justamente porque no
 * falla: la bóveda acepta con gusto un segundo «Mi negocio — panadería», H4 le
 * extrae y clasifica LOS MISMOS valores canónicos otra vez, y el emprendedor
 * termina con su documento fundacional duplicado sin un solo error en ningún
 * log que lo delate. Un efecto que se duplica en silencio no lo cacha nadie.
 *
 * `VaultPort.ingestDocument()` no recibe llave de idempotencia y no se la puedo
 * agregar: `packages/db/ports.ts` es de H1 y el gate de propiedad falla el PR
 * por tocarlo. Es el mismo callejón que la 051 —y la misma salida—: se declara
 * el contrato del lado de quien puede, y se propone el cambio de port en el PR.
 *
 * Así que la llave es el blueprint, que desde la 052 es UNO por Ritual: su
 * `vault_document_id` es el acuse de que el documento ya entró. Lleno, no se
 * manda otra vez; vacío, se manda y se anota. La llamada al port sigue siendo
 * la misma que H4 declaró.
 */
export async function sembrarBoveda(
  ctx: TenantContext,
  blueprint: BlueprintGuardado,
  estado: EstadoNegocio,
): Promise<{ documentId: string; valueIds: string[] } | null> {
  if (blueprint.vaultDocumentId) {
    log.info(
      `el documento madre de este Ritual ya está en la bóveda (${blueprint.vaultDocumentId}); ` +
        'no se manda otra vez.',
    );
    return null;
  }

  const vault = tryPort('vault');
  if (!vault) {
    log.info(
      'VaultPort no registrado (H4 pendiente): el documento madre queda en el blueprint ' +
        'y se puede reenviar cuando aterrice.',
    );
    return null;
  }

  try {
    const resultado = await vault.ingestDocument(ctx, {
      title: `Mi negocio — ${estado.giro ?? 'documento madre'}`,
      content: blueprint.resumen + bloqueDeValores(estado),
      areaSlug: 'direccion',
    });
    // El acuse se anota INMEDIATAMENTE después de la ingesta, y antes de
    // cualquier otra cosa del cierre. Lo que queda entre las dos líneas es la
    // única ventana en la que un segundo cierre podría duplicar el documento,
    // y es una escritura sin modelo de por medio.
    await marcarDocumentoMadre(ctx, blueprint.id, resultado.documentId);
    log.info(`documento madre en la bóveda: ${resultado.valueIds.length} valores en borrador`);
    return resultado;
  } catch (err) {
    log.warn(`la bóveda no aceptó el documento madre: ${String(err)}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// El agente maestro
// ════════════════════════════════════════════════════════════════════════════

/**
 * Reescribe la definición del agente maestro con lo que se aprendió.
 *
 * Es lo que hace que el criterio #3 —"el agente responde con el nombre que le
 * puso, en toda la UI"— no dependa de que la UI se acuerde: el nombre vive en
 * `app.agent_definitions` y `AgentRunResult.agentName` lo trae en cada corrida.
 *
 * Y su `system_prompt` deja de ser el genérico de fábrica: pasa a saber a qué
 * se dedica su dueño, cómo cobra y qué le duele. Las semillas de H3 dicen
 * exactamente eso — "son el punto de partida, no el destino: en cuanto el
 * Ritual descubre el giro y los números, H7 los reescribe".
 */
export async function bautizarAgente(
  ctx: TenantContext,
  estado: EstadoNegocio,
  mapa: MapaDeNegocio | null,
): Promise<void> {
  const nombre = estado.agente?.trim();
  if (!nombre) return;

  const contexto = [
    estado.giro ? `Este negocio se dedica a: ${estado.giro}.` : null,
    estado.nicho ? `Le vende a: ${estado.nicho}.` : null,
    estado.modeloIngreso ? `Gana dinero así: ${estado.modeloIngreso}.` : null,
    (estado.dolores?.length ?? 0) > 0
      ? `Lo que más le pesa a su dueño: ${(estado.dolores ?? []).map((d) => d.texto).join('; ')}.`
      : null,
    mapa && mapa.areas.length > 0
      ? `Áreas activas o disponibles hoy: ${mapa.areas
          .filter((a) => a.estado !== 'bloqueada')
          .map((a) => a.label)
          .join(', ')}.`
      : null,
  ].filter((x): x is string => x !== null);

  const systemPrompt =
    contexto.length > 0
      ? `${PROMPT_MAESTRO_BASE}\n\n--- ESTE NEGOCIO ---\n${contexto.join('\n')}`
      : PROMPT_MAESTRO_BASE;

  try {
    await usePort('agents').upsertDefinition(ctx, {
      role: 'master',
      name: nombre,
      systemPrompt,
    });
    log.info(`agente maestro actualizado: ${nombre}`);
  } catch (err) {
    // No se propaga: el nombre ya está en el estado de la sesión y la UI lo
    // muestra desde ahí. Perder la escritura es recuperable; tumbar el turno
    // del bautizo, no.
    log.warn(`no se pudo actualizar la definición del agente maestro: ${String(err)}`);
  }
}
