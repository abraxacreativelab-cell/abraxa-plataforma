/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las respuestas de la capa de voz. Una sola forma, y sin Next.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Todo lo que sale de aquí es un `Response` del estándar, no un
 *  `NextResponse`. Dos razones, y la segunda es la que importa:
 *
 *   1. Un route handler de Next acepta un `Response` normal. `NextResponse` no
 *      aporta nada que estos dos endpoints usen.
 *   2. Sin importar `next/server`, los handlers se pueden PROBAR llamándolos
 *      con un `new Request(...)` y leyendo el `Response` — sin levantar Next,
 *      sin `next dev`, sin un runtime de Edge simulado. Toda la lógica del
 *      borde HTTP queda cubierta por pruebas que corren en milisegundos.
 *
 *  El formato del error es el del repo entero —`{error:{code,message}}`, con la
 *  tabla de `packages/db/src/errors.ts`— más un bloque `voz` con las dos
 *  banderas que el cliente necesita para decidir sin adivinar. Es el mismo
 *  formato que ya devuelve `middleware.ts:109-112`, así que el cliente no tiene
 *  que distinguir si el «no» vino del middleware o del handler.
 */
import { FalloDeVoz } from '../../../../../packages/auth/src/voz/errores';

/** El error, en JSON, con `no-store` para que un fallo pasajero no se cachee. */
export function respuestaDeFallo(fallo: FalloDeVoz): Response {
  return new Response(JSON.stringify(fallo.cuerpo()), {
    status: fallo.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Cualquier cosa que se haya escapado, convertida en algo que se pueda leer.
 *
 * Un `500 Internal Server Error` desnudo obliga a quien llama a adivinar si
 * reintentar. Aquí lo que no es un `FalloDeVoz` sale como `PROVIDER_ERROR`
 * —reintentable, no definitivo—, que es la lectura correcta de «no sé qué
 * pasó»: puede que a la siguiente sí.
 */
export function respuestaDeError(e: unknown): Response {
  if (FalloDeVoz.es(e)) return respuestaDeFallo(e);
  return respuestaDeFallo(
    new FalloDeVoz('PROVIDER_ERROR', 'La capa de voz falló de una forma no prevista.', {
      cause: e,
    }),
  );
}

export function respuestaJson(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * El 401 de la capa. Idéntico —código y forma— al del middleware.
 *
 * Existe aparte porque el handler NO puede confiar en que el middleware ya lo
 * haya negado: el middleware protege por RUTA, y una ruta se puede quedar fuera
 * de su matcher por un despliegue mal hecho, un `location` de nginx que la
 * saque de Next, o una versión de Next que cambie el orden. Dos redes, no una.
 */
export const SIN_SESION = (): FalloDeVoz =>
  new FalloDeVoz(
    'UNAUTHENTICATED',
    'Necesitas iniciar sesión. La voz cuesta dinero por segundo y no se le presta a nadie ' +
      'sin identidad.',
  );
