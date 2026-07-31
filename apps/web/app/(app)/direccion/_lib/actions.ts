'use server';

/**
 * Las escrituras de la bóveda, como Server Actions.
 *
 * Cada una vuelve a resolver el contexto desde el servidor: nunca recibe un
 * `tenantId` del cliente. Si lo recibiera, sería exactamente la puerta por
 * donde se fuga un cliente a otro — y de nada serviría todo lo demás.
 *
 * Los errores se devuelven como valor, no se lanzan: la pantalla necesita
 * poder enseñar «Ya existe un valor con esa clave, edítalo en vez de crear
 * otro» en vez de una página de error genérica.
 */

import { revalidatePath } from 'next/cache';
import { PlatformError } from '@abraxa/db';
import {
  aprobarValor,
  archivarDocumento,
  borrarValor,
  crearValor,
  desactivarValor,
  editarDocumento,
  editarValor,
  ingestDocument,
  resolverConflicto,
  type DecisionConflicto,
  type DocStatus,
  type DocType,
  type IngestResult,
} from '@abraxa/vault/api';
import { contextoActual } from './session';

export interface Resultado<T = undefined> {
  ok: boolean;
  mensaje: string;
  datos?: T;
}

async function ejecutar<T>(
  fn: () => Promise<{ mensaje: string; datos?: T }>,
  rutas: string[] = ['/direccion'],
): Promise<Resultado<T>> {
  try {
    const { mensaje, datos } = await fn();
    for (const r of rutas) revalidatePath(r);
    return { ok: true, mensaje, datos };
  } catch (e) {
    if (PlatformError.is(e)) return { ok: false, mensaje: e.message };
    console.error('[direccion] acción falló', e);
    return { ok: false, mensaje: 'Algo falló de nuestro lado. Vuelve a intentarlo.' };
  }
}

const RUTAS_VALORES = ['/direccion', '/direccion/valores'];
const RUTAS_BIBLIOTECA = ['/direccion', '/direccion/biblioteca'];

// ═══ Valores ════════════════════════════════════════════════════════════════

/**
 * El clic que convierte una propuesta en un dato oficial.
 * El mensaje dice QUÉ se propagó, no un "listo": el emprendedor tiene que
 * poder confirmar de un vistazo que aprobó lo que creía.
 */
export async function accionAprobar(id: string): Promise<Resultado> {
  return ejecutar(async () => {
    const ctx = await contextoActual();
    const { propagado } = await aprobarValor(ctx, id);
    return { mensaje: `Aprobado y propagado a contratos, mensajes y agentes · ${propagado}` };
  }, RUTAS_VALORES);
}

export async function accionDesactivar(id: string): Promise<Resultado> {
  return ejecutar(async () => {
    const ctx = await contextoActual();
    const v = await desactivarValor(ctx, id);
    return {
      mensaje: `«${v.label}» volvió a borrador. Deja de usarse en contratos y agentes.`,
    };
  }, RUTAS_VALORES);
}

export async function accionGuardarValor(
  id: string | null,
  campos: Record<string, unknown>,
): Promise<Resultado<{ id: string }>> {
  return ejecutar(async () => {
    const ctx = await contextoActual();
    const v = id ? await editarValor(ctx, id, campos) : await crearValor(ctx, campos);
    return {
      mensaje: v.active
        ? `«${v.label}» guardado y propagado como {valor.${v.key}}.`
        : `«${v.label}» guardado como borrador. Apruébalo para que empiece a usarse.`,
      datos: { id: v.id },
    };
  }, RUTAS_VALORES);
}

/**
 * Cuando un documento nuevo contradice un número que ya se aprobó, la ingesta
 * NO decide: lo deja marcado. Aquí es donde decide la persona.
 *
 * El mensaje dice qué queda vigente en los dos casos, no un "listo": el punto
 * de todo esto es que nadie se entere tarde de que su precio cambió.
 */
export async function accionResolverConflicto(
  id: string,
  decision: DecisionConflicto,
): Promise<Resultado> {
  return ejecutar(async () => {
    const ctx = await contextoActual();
    const { propagado } = await resolverConflicto(ctx, id, decision);
    return {
      mensaje:
        decision === 'aceptar'
          ? `Actualizado y propagado a contratos, mensajes y agentes · ${propagado}`
          : `Se descartó lo que decía el documento nuevo · ${propagado}`,
    };
  }, RUTAS_VALORES);
}

export async function accionBorrarValor(id: string): Promise<Resultado> {
  return ejecutar(async () => {
    const ctx = await contextoActual();
    await borrarValor(ctx, id);
    return { mensaje: 'Valor eliminado.' };
  }, RUTAS_VALORES);
}

// ═══ Documentos ═════════════════════════════════════════════════════════════

export async function accionGuardarDocumento(
  id: string,
  campos: {
    title?: string;
    content?: string;
    areaSlug?: string | null;
    docType?: DocType;
    status?: DocStatus;
  },
): Promise<Resultado<{ version: number }>> {
  return ejecutar(async () => {
    const ctx = await contextoActual();
    const doc = await editarDocumento(ctx, id, {
      title: campos.title,
      content: campos.content,
      areaSlug: campos.areaSlug,
      docType: campos.docType,
      status: campos.status,
    });
    return {
      mensaje: `Guardado como versión ${doc.version}. La anterior queda en el historial.`,
      datos: { version: doc.version },
    };
  }, [...RUTAS_BIBLIOTECA, `/direccion/biblioteca/${id}`]);
}

export async function accionArchivarDocumento(id: string): Promise<Resultado> {
  return ejecutar(async () => {
    const ctx = await contextoActual();
    await archivarDocumento(ctx, id);
    // Archivar y no borrar: el documento es de dónde salieron los valores que
    // ya se aprobaron. Borrarlo dejaría cifras vivas sin origen.
    return { mensaje: 'Documento archivado. Sigue disponible en el historial.' };
  }, RUTAS_BIBLIOTECA);
}

// ═══ Ingesta ════════════════════════════════════════════════════════════════

export async function accionIngerir(
  contenido: string,
  opciones: { titulo?: string; areaSlug?: string } = {},
): Promise<Resultado<IngestResult>> {
  return ejecutar(async () => {
    const ctx = await contextoActual();
    const r = await ingestDocument(ctx, {
      content: contenido,
      title: opciones.titulo || undefined,
      areaSlug: opciones.areaSlug || undefined,
      sourceKind: 'paste',
    });
    return {
      mensaje:
        r.valores.length > 0
          ? `Guardado. Encontré ${r.valores.length} dato${r.valores.length === 1 ? '' : 's'} para que revises.`
          : 'Documento guardado. No encontré cifras que proponerte.',
      datos: r,
    };
  }, [...RUTAS_VALORES, ...RUTAS_BIBLIOTECA]);
}
