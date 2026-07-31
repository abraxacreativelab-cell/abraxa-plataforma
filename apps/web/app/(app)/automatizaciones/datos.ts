/**
 * La única puerta por la que el NAVEGADOR obtiene datos de esta pantalla.
 *
 * Todo pasa por el BFF de `api/`, nunca directo a `apps/api`: la sesión vive
 * en el servidor de Next y las cabeceras del contrato las pone él. Ver
 * `api/bff.ts`.
 *
 * Tres estados y ni uno más, como en `contactos/datos.ts` de H15:
 *
 *   'datos'       la API contestó. Vacío NO es un error.
 *   'error'       contestó mal o no contestó. Se dice por qué.
 *   'sin-cablear' todavía no hay sesión (la entrega H18). Es un estado
 *                 DISTINTO del error, y separarlo es lo que evita que alguien
 *                 pierda una tarde depurando datos que nunca fueron reales.
 */
import type { Flow, FlowRun, FlowVersion, RunSnapshot } from '@abraxa/flows/ui';

export type Resultado<T> =
  | { estado: 'datos'; datos: T }
  | { estado: 'error'; mensaje: string }
  | { estado: 'sin-cablear'; motivo: string };

const BASE = '/automatizaciones/api';

interface CuerpoDeError {
  error?: { code?: string; message?: string; details?: { errores?: string[] } };
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<Resultado<T>> {
  try {
    const r = await fetch(`${BASE}${ruta}`, {
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      ...init,
    });
    const cuerpo = (await r.json().catch(() => null)) as (T & CuerpoDeError) | null;

    if (r.status === 501) {
      return {
        estado: 'sin-cablear',
        motivo:
          cuerpo?.error?.message ??
          'Todavía no hay sesión verificada: la entrega H18 (identidad).',
      };
    }
    if (!r.ok) {
      const detalles = cuerpo?.error?.details?.errores;
      return {
        estado: 'error',
        mensaje: detalles?.length
          ? `${cuerpo?.error?.message ?? 'No se pudo guardar'}:\n· ${detalles.join('\n· ')}`
          : (cuerpo?.error?.message ?? `La API respondió ${r.status}`),
      };
    }
    return { estado: 'datos', datos: cuerpo as T };
  } catch (e) {
    return { estado: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo conectar' };
  }
}

const conCuerpo = (metodo: string, datos?: unknown): RequestInit => ({
  method: metodo,
  ...(datos === undefined ? {} : { body: JSON.stringify(datos) }),
});

export const cargarFlujos = (): Promise<Resultado<Flow[]>> => pedir('');
export const cargarFlujo = (id: string): Promise<Resultado<Flow>> => pedir(`/${id}`);

export const guardarFlujo = (id: string, propuesta: unknown): Promise<Resultado<Flow>> =>
  pedir(`/${id}`, conCuerpo('PUT', propuesta));

export const crearFlujo = (propuesta: unknown): Promise<Resultado<Flow>> =>
  pedir('', conCuerpo('POST', propuesta));

export const activarFlujo = (id: string): Promise<Resultado<Flow>> =>
  pedir(`/${id}/activar`, conCuerpo('POST'));

export const pausarFlujo = (id: string): Promise<Resultado<Flow>> =>
  pedir(`/${id}/pausar`, conCuerpo('POST'));

export const probarFlujo = (
  id: string,
  contactId?: string,
): Promise<Resultado<{ corridas: number; razon?: string; runId?: string }>> =>
  pedir(`/${id}/probar`, conCuerpo('POST', contactId ? { contactId } : {}));

export const cargarVersiones = (id: string): Promise<Resultado<FlowVersion[]>> =>
  pedir(`/${id}/versiones`);

export const restaurarVersion = (id: string, version: number): Promise<Resultado<Flow>> =>
  pedir(`/${id}/versiones/${version}/restaurar`, conCuerpo('POST'));

export const cargarCorridas = (flujoId?: string): Promise<Resultado<FlowRun[]>> =>
  pedir(`/runs${flujoId ? `?flujo=${encodeURIComponent(flujoId)}` : ''}`);

export const cargarCorrida = (runId: string): Promise<Resultado<RunSnapshot>> =>
  pedir(`/runs/${runId}`);

export const pedirPropuesta = (
  descripcion: string,
): Promise<Resultado<{ propuesta: unknown; notas: string | null }>> =>
  pedir('/asistente', conCuerpo('POST', { descripcion }));

export const revisarFlujo = (
  propuesta: unknown,
): Promise<Resultado<{ ok: boolean; errores: string[] }>> =>
  pedir('/revisar', conCuerpo('POST', propuesta));
