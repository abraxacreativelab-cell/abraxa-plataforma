import type { Metadata } from 'next';
import { Espera } from './espera';
import { Ritual } from './ritual';
import { baseDeLaApi, cabecerasPara, identidadDeLaSesion } from './lib/sesion';
import type { Foto, Impedimento } from './lib/tipos';

export const metadata: Metadata = { title: 'El Ritual de Fundación' };

/**
 * Es lo PRIMERO que vive un emprendedor en el producto, y lo que decide si se
 * queda.
 *
 * Componente de servidor a propósito: el estado del Ritual —fase, avance,
 * conversación y lo que el agente ya sabe del negocio— llega YA RESUELTO en el
 * HTML. Quien vuelve al día siguiente abre esta página y lee su propia
 * conversación de inmediato, sin un parpadeo de pantalla vacía y sin esperar a
 * que un modelo conteste. Ésa es la cara visible del criterio #2.
 */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const resultado = await cargar();

  if ('impedimento' in resultado) return <Espera impedimento={resultado.impedimento} />;

  return <Ritual inicial={resultado.foto} />;
}

async function cargar(): Promise<{ foto: Foto } | { impedimento: Impedimento }> {
  const identidad = await identidadDeLaSesion();

  if (!identidad) {
    return {
      impedimento: {
        tipo: 'sesion',
        mensaje:
          'identidadDeLaSesion() → null · lo cablea H2 · apps/web/app/(onboarding)/ritual/lib/sesion.ts',
      },
    };
  }

  try {
    const r = await fetch(`${baseDeLaApi()}/onboarding/ritual`, {
      headers: cabecerasPara(identidad),
      cache: 'no-store',
    });

    if (r.ok) return { foto: (await r.json()) as Foto };

    const cuerpo = (await r.json().catch(() => null)) as { error?: { message: string } } | null;
    const mensaje = cuerpo?.error?.message ?? `La API respondió ${r.status}.`;

    // 501 es PORT_NOT_IMPLEMENTED: falta un carril, no falló nada.
    return { impedimento: { tipo: r.status === 501 ? 'puerto' : 'desconocido', mensaje } };
  } catch (err) {
    return {
      impedimento: {
        tipo: 'red',
        mensaje: `fetch ${baseDeLaApi()}/onboarding/ritual → ${String(err)}`,
      },
    };
  }
}
