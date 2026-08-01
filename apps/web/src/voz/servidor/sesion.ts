/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Quién está pidiendo la voz. Resuelto SIEMPRE server-side.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Un endpoint de transcripción abierto al mundo es la factura de otro: cuesta
 *  dinero por segundo de audio y lo cobra la cuenta de ABRAXA. Lo mismo con la
 *  narración. Así que los dos exigen sesión, y la sesión sale de la cookie
 *  firmada — nunca de una cabecera ni de un parámetro.
 *
 *  ── `authOptions` NO ES OPCIONAL ───────────────────────────────────────────
 *
 *  Es el bug que ya costó el producto una vez (PR #27, y la excepción
 *  transversal de H0 del 2026-08-01). `getServerSession()` sin opciones NO
 *  ejecuta el callback `session` —que vive en ellas— y ese callback es quien
 *  pone `tenantSlug`. Con una sesión de Google perfectamente válida ya emitida,
 *  la guarda veía `undefined` y devolvía `null`: indistinguible de «no hay
 *  sesión», sin error y sin log.
 *
 *  El aviso está escrito en `apps/web/app/api/auth/opciones.ts:15-18`. Aquí se
 *  pasan, y `voz-sesion.test.ts` lo comprueba llamando al handler con un
 *  cargador que devuelve una sesión SIN opciones aplicadas.
 *
 *  ── Por qué basta el correo, y no se exige empresa ─────────────────────────
 *
 *  Porque la voz no toca un solo dato de dominio: no lee contactos, no escribe
 *  documentos, no sabe de qué empresa es nadie. Sintetiza un texto que le
 *  mandan y transcribe un audio que le suben.
 *
 *  Y porque exigir `tenantSlug` rompería exactamente al invitado del evento: un
 *  usuario autenticado que todavía NO tiene empresa —el estado de cualquiera
 *  que va a mitad del Ritual— pasa el middleware con `empresa: null`. Pedirle
 *  empresa a la voz sería apagarle el micrófono justo a quien lo necesita.
 *
 *  La empresa se lleva de todos modos, porque es lo que hace que un log de una
 *  noche de evento sirva para algo.
 */

/** Quién está pidiendo. `empresa` es `null` antes de terminar el Ritual. */
export interface QuienEntra {
  correo: string;
  empresa: string | null;
}

interface SesionConTenant {
  user?: { email?: string | null; tenantSlug?: string | null } | null;
}

/**
 * La sesión verificada, o nada.
 *
 * Falla CERRADA: cualquier excepción —el módulo ausente, una cookie corrupta,
 * un secreto que no cuadra— sale como `null` y el handler contesta 401. Dejar
 * pasar cuando algo no se puede verificar es cómo se cuela una factura ajena.
 *
 * Los imports son dinámicos igual que en el Ritual: mantienen esta carpeta
 * desacoplada del arranque del módulo y permiten que las pruebas del handler
 * corran sin NextAuth en el proyecto.
 */
export async function quienEntra(): Promise<QuienEntra | null> {
  try {
    const [modulo, opciones] = await Promise.all([
      import('next-auth/next') as unknown as Promise<{
        getServerSession: (o: unknown) => Promise<SesionConTenant | null>;
      }>,
      import('../../../app/api/auth/opciones'),
    ]);

    // `opciones.authOptions` — ver el bloque de arriba. Sin esto, todo lo demás
    // de este archivo es decorativo.
    const sesion = await modulo.getServerSession(opciones.authOptions);

    const correo = sesion?.user?.email;
    if (typeof correo !== 'string' || correo.trim().length === 0) return null;

    const empresa = sesion?.user?.tenantSlug;
    return {
      correo: correo.trim().toLowerCase(),
      empresa: typeof empresa === 'string' && empresa.trim().length > 0 ? empresa.trim() : null,
    };
  } catch {
    return null;
  }
}
