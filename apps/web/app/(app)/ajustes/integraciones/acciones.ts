'use server';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Conectar, comprobar y desconectar — desde el servidor, nunca desde el
 *  navegador
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Estas tres acciones corren en el SERVIDOR de Next, y eso no es una
 *  preferencia de estilo:
 *
 *   · El secreto que el emprendedor escribe viaja del formulario a este proceso
 *     y de aquí a la API. **Nunca pasa por código de cliente**: no hay un
 *     `fetch` desde el navegador con la llave de Evolution en el cuerpo, no hay
 *     una variable pública con la URL de la API, y `PROXY_SECRET` no sale del
 *     servidor.
 *   · Lo que vuelve al navegador es lo que la pantalla ya podía ver: la
 *     integración con su huella y su estado. El valor no vuelve nunca, ni
 *     siquiera el que se acaba de escribir — un `defaultValue` con el secreto
 *     sería exactamente la fuga que este carril viene a cerrar.
 *
 *  El resultado se comunica volviendo a la pantalla con un aviso en la URL, y
 *  no con estado de cliente. Así esto funciona sin una línea de JavaScript en
 *  el navegador, y lo que se ve después de guardar es el ESTADO REAL que
 *  devolvió el proveedor, no un mensaje optimista.
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { BASE_API, cabeceras } from './datos';

const RUTA = '/ajustes/integraciones';

/**
 * Los avisos que la pantalla sabe pintar. Conjunto CERRADO a propósito: lo que
 * llega por la URL no puede inventar un mensaje.
 *
 * El tipo NO se exporta: un módulo `'use server'` sólo puede exportar funciones
 * asíncronas, y una excepción "inofensiva" hoy es un build roto mañana.
 */
type Aviso = 'ok' | 'guardado-sin-verificar' | 'error' | 'sin-sesion' | 'revocada';

function volver(aviso: Aviso, detalle?: string): never {
  const params = new URLSearchParams({ aviso });
  // El detalle viene de la API, que ya lo devuelve saneado y sin `details`
  // internos. Se recorta igual: una URL no es sitio para un párrafo.
  if (detalle) params.set('detalle', detalle.slice(0, 200));
  redirect(`${RUTA}?${params.toString()}`);
}

async function mandar(
  ruta: string,
  cuerpo?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; datos: unknown }> {
  const cab = cabeceras();
  if (!cab) return { ok: false, status: 401, datos: null };

  const r = await fetch(`${BASE_API}${ruta}`, {
    method: 'POST',
    headers: { ...cab, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo ?? {}),
    cache: 'no-store',
  });

  let datos: unknown = null;
  try {
    datos = await r.json();
  } catch {
    datos = null;
  }
  return { ok: r.ok, status: r.status, datos };
}

/** El mensaje de error de la API, que ya viene sin `details` internos. */
function mensajeDe(datos: unknown, porDefecto: string): string {
  const e = (datos as { error?: { message?: string } } | null)?.error;
  return typeof e?.message === 'string' && e.message ? e.message : porDefecto;
}

/**
 * Conectar o reconectar.
 *
 * Los campos de configuración los declara cada proveedor en el catálogo del
 * paquete (`providers/catalogo.ts`), así que agregar uno nuevo no toca esta
 * pantalla: lo que no es el secreto ni un campo reservado se manda como
 * `config`.
 */
export async function conectar(form: FormData): Promise<void> {
  if (!cabeceras()) volver('sin-sesion');

  const provider = String(form.get('provider') ?? '').trim();
  const secret = String(form.get('secret') ?? '');
  const label = String(form.get('label') ?? '').trim();
  const externalAccountId = String(form.get('externalAccountId') ?? '').trim();

  if (!provider) volver('error', 'Falta decir qué canal se está conectando.');
  if (!secret.trim()) volver('error', 'Falta la credencial.');

  const config: Record<string, unknown> = {};
  for (const [clave, valor] of form.entries()) {
    if (['provider', 'secret', 'label', 'externalAccountId'].includes(clave)) continue;
    if (typeof valor === 'string' && valor.trim()) config[clave] = valor.trim();
  }

  const r = await mandar('/integrations', {
    provider,
    secret,
    label: label || undefined,
    externalAccountId: externalAccountId || undefined,
    config,
  });

  revalidatePath(RUTA);

  if (!r.ok) volver('error', mensajeDe(r.datos, 'No se pudo guardar la credencial.'));

  const datos = r.datos as { status?: string; verify?: { reason?: string } } | null;
  if (datos?.status === 'connected') volver('ok');

  // Guardado ≠ conectado, y decirlo es el punto entero de este carril: una
  // palomita verde sobre una credencial que el proveedor no aceptó es cómo se
  // llega a "conecté mi WhatsApp y nadie contestó".
  volver('guardado-sin-verificar', datos?.verify?.reason ?? undefined);
}

/** El botón "volver a probar". */
export async function verificar(form: FormData): Promise<void> {
  if (!cabeceras()) volver('sin-sesion');

  const id = String(form.get('id') ?? '');
  if (!id) volver('error', 'Falta decir cuál comprobar.');

  const r = await mandar(`/integrations/${encodeURIComponent(id)}/verificar`);
  revalidatePath(RUTA);

  if (!r.ok) volver('error', mensajeDe(r.datos, 'No se pudo comprobar.'));

  const resultado = r.datos as { ok?: boolean; reason?: string } | null;
  if (resultado?.ok) volver('ok');
  volver('error', resultado?.reason ?? 'El proveedor no la aceptó.');
}

/** Desconectar. Deja la fila en `revoked` y deja de rutear de inmediato. */
export async function revocar(form: FormData): Promise<void> {
  if (!cabeceras()) volver('sin-sesion');

  const id = String(form.get('id') ?? '');
  if (!id) volver('error', 'Falta decir cuál desconectar.');

  const r = await mandar(`/integrations/${encodeURIComponent(id)}/revocar`);
  revalidatePath(RUTA);

  if (!r.ok) volver('error', mensajeDe(r.datos, 'No se pudo desconectar.'));
  volver('revocada');
}
