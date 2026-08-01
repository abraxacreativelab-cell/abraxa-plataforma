/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El handler de NARRAR, entero, sin levantar Next.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Se le pasa un `new Request(...)` y se lee el `Response`. Eso es posible
 *  porque `servidor/narrar.ts` no importa nada de `next/*` — ver el comentario
 *  de `servidor/http.ts`.
 *
 *  Lo que se prueba aquí es lo que se rompe en producción: que un anónimo no
 *  gaste un centavo, que el streaming sea streaming de verdad, que la caché no
 *  guarde audio a medias, y que la factura sin pagar de ElevenLabs salga
 *  tipada en vez de como un 500 desnudo.
 */
import { describe, expect, it, vi } from 'vitest';
import { CacheDeNarracion } from '../../../../packages/auth/src/voz/cache';
import { manejarNarrar } from './servidor/narrar';
import type { QuienEntra } from './servidor/sesion';

const INVITADO: QuienEntra = { correo: 'invitado@ejemplo.com', empresa: 'mi-negocio' };

const ENV = {
  ELEVENLABS_API_KEY: 'llave-de-prueba',
  ELEVENLABS_VOICE_ANA: 'voz-ana',
  ELEVENLABS_VOICE_CARI: 'voz-cari',
};

const conSesion = async (): Promise<QuienEntra | null> => INVITADO;
const sinSesion = async (): Promise<QuienEntra | null> => null;

/** Un cuerpo que llega en varios trozos, como el de ElevenLabs. */
function streamDe(trozos: readonly string[], entreTrozos?: () => void): ReadableStream<Uint8Array> {
  const codificador = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(control) {
      if (i >= trozos.length) {
        control.close();
        return;
      }
      control.enqueue(codificador.encode(trozos[i]));
      i += 1;
      entreTrozos?.();
    },
  });
}

function fetchQueDevuelve(
  cuerpo: ReadableStream<Uint8Array> | string,
  init: ResponseInit = {},
): typeof globalThis.fetch {
  return vi.fn(async () => new Response(cuerpo as BodyInit, init)) as unknown as typeof fetch;
}

const GET = (texto: string, voz?: string): Request =>
  new Request(
    `https://mi.abraxa.club/voz/api/narrar?texto=${encodeURIComponent(texto)}` +
      (voz ? `&voz=${voz}` : ''),
  );

const POST = (cuerpo: unknown): Request =>
  new Request('https://mi.abraxa.club/voz/api/narrar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });

// ═══════════════════════════════════════════════════════════════════════════

describe('narrar — la puerta', () => {
  it('un ANÓNIMO recibe 401 y NO se llama a ElevenLabs', async () => {
    // Es el requisito entero: un endpoint de voz abierto es la factura de otro.
    // Y se comprueba las dos cosas: el status, y que no se gastó un centavo.
    const hacerFetch = fetchQueDevuelve('no debería llamarse');

    const r = await manejarNarrar(GET('hola'), {
      sesion: sinSesion,
      env: ENV,
      fetch: hacerFetch,
    });

    expect(r.status).toBe(401);
    expect(hacerFetch).not.toHaveBeenCalled();

    const cuerpo = (await r.json()) as { error: { code: string } };
    expect(cuerpo.error.code).toBe('UNAUTHENTICATED');
  });

  it('el 401 tiene la MISMA forma que el del middleware', async () => {
    // `middleware.ts:109-112` contesta {error:{code,message}}. Si esto se
    // separara, el cliente tendría que distinguir de dónde vino el «no».
    const r = await manejarNarrar(GET('hola'), { sesion: sinSesion, env: ENV });
    const cuerpo = (await r.json()) as { error: { code: string; message: string } };

    expect(cuerpo.error).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(typeof cuerpo.error.message).toBe('string');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('un invitado SIN empresa sí puede narrar', async () => {
    // Es el estado de cualquiera a mitad del Ritual. Exigirle empresa sería
    // apagarle la voz justo a quien la necesita.
    const r = await manejarNarrar(GET('hola'), {
      sesion: async () => ({ correo: 'nuevo@ejemplo.com', empresa: null }),
      env: ENV,
      fetch: fetchQueDevuelve(streamDe(['audio'])),
    });
    expect(r.status).toBe(200);
  });
});

describe('narrar — validación', () => {
  it('sin texto: 422 y no se llama a nadie', async () => {
    const hacerFetch = fetchQueDevuelve('x');
    const r = await manejarNarrar(new Request('https://x/voz/api/narrar'), {
      sesion: conSesion,
      env: ENV,
      fetch: hacerFetch,
    });
    expect(r.status).toBe(422);
    expect(hacerFetch).not.toHaveBeenCalled();
  });

  it('texto vacío o de puros espacios: 422', async () => {
    for (const malo of ['', '   ']) {
      const r = await manejarNarrar(GET(malo), { sesion: conSesion, env: ENV });
      expect(r.status).toBe(422);
    }
  });

  it('un POST con JSON roto no revienta: 422 tipado', async () => {
    const r = await manejarNarrar(POST('{ esto no es json'), { sesion: conSesion, env: ENV });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('por la URL el tope es más bajo, y el mensaje dice usar POST', async () => {
    const r = await manejarNarrar(GET('a'.repeat(800)), { sesion: conSesion, env: ENV });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain('POST');
  });

  it('el mismo texto por POST sí pasa', async () => {
    const r = await manejarNarrar(POST({ texto: 'a'.repeat(800) }), {
      sesion: conSesion,
      env: ENV,
      fetch: fetchQueDevuelve(streamDe(['audio'])),
    });
    expect(r.status).toBe(200);
  });
});

describe('narrar — sin llave configurada', () => {
  it('501 definitivo, con el nombre de la variable, y sin llamar a nadie', async () => {
    const hacerFetch = fetchQueDevuelve('x');
    const r = await manejarNarrar(GET('hola'), { sesion: conSesion, env: {}, fetch: hacerFetch });

    expect(r.status).toBe(501);
    expect(hacerFetch).not.toHaveBeenCalled();

    const cuerpo = (await r.json()) as {
      error: { code: string; message: string; voz: { definitivo: boolean } };
    };
    expect(cuerpo.error.code).toBe('PORT_NOT_IMPLEMENTED');
    expect(cuerpo.error.message).toContain('ELEVENLABS_API_KEY');
    // Lo que le dice al cliente «apaga la voz y no vuelvas a intentarlo».
    expect(cuerpo.error.voz.definitivo).toBe(true);
  });
});

describe('narrar — el camino bueno', () => {
  it('devuelve audio y le pide a ElevenLabs el endpoint de STREAMING', async () => {
    const hacerFetch = vi.fn(
      async () => new Response(streamDe(['uno', 'dos', 'tres'])),
    ) as unknown as typeof fetch;

    const r = await manejarNarrar(GET('¿Cómo se llama tu negocio?'), {
      sesion: conSesion,
      env: ENV,
      fetch: hacerFetch,
      cache: new CacheDeNarracion(),
    });

    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('x-abraxa-voz')).toBe('elevenlabs');
    expect(await r.text()).toBe('unodostres');

    // `calls[0]` es `T | undefined` con noUncheckedIndexedAccess; el `??` deja
    // la desestructuración tipada sin tapar un fallo real: si no hubo llamada,
    // las aserciones de abajo fallan igual, pero con un mensaje que se entiende.
    const [url, init] = (hacerFetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0] ?? ['', {} as RequestInit];
    expect(url).toContain('/v1/text-to-speech/voz-ana/stream');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('llave-de-prueba');
  });

  it('el cuerpo SALE trozo a trozo: no se espera al final', async () => {
    // Lo que se comprueba es que el primer trozo ya está leíble en el cliente
    // ANTES de que el proveedor haya mandado el último. Si el handler
    // acumulara, este `read()` se bloquearía hasta el final.
    let generados = 0;
    const hacerFetch = fetchQueDevuelve(
      streamDe(['primero', 'segundo', 'tercero'], () => {
        generados += 1;
      }),
    );

    const r = await manejarNarrar(GET('hola'), { sesion: conSesion, env: ENV, fetch: hacerFetch });
    const lector = r.body!.getReader();
    const primero = await lector.read();

    expect(new TextDecoder().decode(primero.value)).toBe('primero');
    expect(generados).toBeLessThan(3); // el proveedor todavía no terminó

    await lector.cancel();
  });

  it('la voz `cari` usa su propio id', async () => {
    const hacerFetch = vi.fn(async () => new Response(streamDe(['a']))) as unknown as typeof fetch;
    await manejarNarrar(GET('hola', 'cari'), { sesion: conSesion, env: ENV, fetch: hacerFetch });

    const [url] = (hacerFetch as unknown as { mock: { calls: [string][] } }).mock.calls[0] ?? [''];
    expect(url).toContain('/voz-cari/stream');
  });

  it('una voz inventada cae en `ana` en vez de fallar', async () => {
    const hacerFetch = vi.fn(async () => new Response(streamDe(['a']))) as unknown as typeof fetch;
    await manejarNarrar(GET('hola', 'la-de-morgan-freeman'), {
      sesion: conSesion,
      env: ENV,
      fetch: hacerFetch,
    });
    const [url] = (hacerFetch as unknown as { mock: { calls: [string][] } }).mock.calls[0] ?? [''];
    expect(url).toContain('/voz-ana/stream');
  });
});

describe('narrar — la caché', () => {
  it('la segunda vez no vuelve a llamar a ElevenLabs', async () => {
    const cache = new CacheDeNarracion();
    const hacerFetch = vi.fn(
      async () => new Response(streamDe(['au', 'dio'])),
    ) as unknown as typeof fetch;
    const deps = { sesion: conSesion, env: ENV, fetch: hacerFetch, cache };

    const primera = await manejarNarrar(GET('la misma pregunta'), deps);
    expect(await primera.text()).toBe('audio');
    expect(primera.headers.get('x-abraxa-voz')).toBe('elevenlabs');

    const segunda = await manejarNarrar(GET('la misma pregunta'), deps);
    expect(await segunda.text()).toBe('audio');
    expect(segunda.headers.get('x-abraxa-voz')).toBe('cache');
    // Lo que hace que el invitado número doce no espere.
    expect(hacerFetch).toHaveBeenCalledTimes(1);
  });

  it('el acierto trae content-length, para que el `<audio>` pueda buscar', async () => {
    const cache = new CacheDeNarracion();
    const deps = {
      sesion: conSesion,
      env: ENV,
      fetch: fetchQueDevuelve(streamDe(['12345'])),
      cache,
    };
    await (await manejarNarrar(GET('x'), deps)).text();
    const segunda = await manejarNarrar(GET('x'), deps);
    expect(segunda.headers.get('content-length')).toBe('5');
  });

  it('NO cachea si el navegador cortó a media frase', async () => {
    // Media narración cacheada se serviría entera y cortada para siempre.
    const cache = new CacheDeNarracion();
    const hacerFetch = vi.fn(
      async () => new Response(streamDe(['uno', 'dos', 'tres', 'cuatro'])),
    ) as unknown as typeof fetch;
    const deps = { sesion: conSesion, env: ENV, fetch: hacerFetch, cache };

    const primera = await manejarNarrar(GET('cortada'), deps);
    const lector = primera.body!.getReader();
    await lector.read();
    await lector.cancel(); // el invitado calló la voz

    const segunda = await manejarNarrar(GET('cortada'), deps);
    expect(segunda.headers.get('x-abraxa-voz')).toBe('elevenlabs');
    expect(hacerFetch).toHaveBeenCalledTimes(2);
  });

  it('la misma frase con otra voz NO es un acierto', async () => {
    const cache = new CacheDeNarracion();
    const hacerFetch = vi.fn(async () => new Response(streamDe(['a']))) as unknown as typeof fetch;
    const deps = { sesion: conSesion, env: ENV, fetch: hacerFetch, cache };

    await (await manejarNarrar(GET('hola', 'ana'), deps)).text();
    const otra = await manejarNarrar(GET('hola', 'cari'), deps);

    expect(otra.headers.get('x-abraxa-voz')).toBe('elevenlabs');
    expect(hacerFetch).toHaveBeenCalledTimes(2);
  });

  it('GET y POST con el mismo texto comparten caché', async () => {
    const cache = new CacheDeNarracion();
    const hacerFetch = vi.fn(async () => new Response(streamDe(['a']))) as unknown as typeof fetch;
    const deps = { sesion: conSesion, env: ENV, fetch: hacerFetch, cache };

    await (await manejarNarrar(GET('misma cosa'), deps)).text();
    const porPost = await manejarNarrar(POST({ texto: 'misma cosa' }), deps);

    expect(porPost.headers.get('x-abraxa-voz')).toBe('cache');
    expect(hacerFetch).toHaveBeenCalledTimes(1);
  });

  it('el texto se normaliza antes de la clave: dos escrituras, un solo audio', async () => {
    const cache = new CacheDeNarracion();
    const hacerFetch = vi.fn(async () => new Response(streamDe(['a']))) as unknown as typeof fetch;
    const deps = { sesion: conSesion, env: ENV, fetch: hacerFetch, cache };

    await (await manejarNarrar(GET('Hola.  ¿Qué tal?'), deps)).text();
    const conSaltos = await manejarNarrar(GET('  Hola.\n¿Qué tal?  '), deps);

    expect(conSaltos.headers.get('x-abraxa-voz')).toBe('cache');
  });
});

describe('narrar — cuando ElevenLabs dice que no', () => {
  it('LA FACTURA SIN PAGAR sale 402 definitivo, no 500', async () => {
    // El cuerpo es el REAL, medido el 2026-08-01 contra la cuenta de ABRAXA.
    const cuerpoReal = JSON.stringify({
      detail: {
        type: 'payment_required',
        code: 'payment_issue',
        message: 'Your subscription has a failed or incomplete payment.',
      },
    });

    const r = await manejarNarrar(GET('hola'), {
      sesion: conSesion,
      env: ENV,
      fetch: fetchQueDevuelve(cuerpoReal, { status: 401 }),
    });

    expect(r.status).toBe(402);
    const cuerpo = (await r.json()) as {
      error: { code: string; message: string; voz: { definitivo: boolean; reintentable: boolean } };
    };
    expect(cuerpo.error.code).toBe('BUDGET_EXCEEDED');
    expect(cuerpo.error.voz.definitivo).toBe(true);
    expect(cuerpo.error.voz.reintentable).toBe(false);
    // Y no filtra la llave por ningún lado.
    expect(JSON.stringify(cuerpo)).not.toContain('llave-de-prueba');
  });

  it('un 500 del proveedor sale como 502 reintentable', async () => {
    const r = await manejarNarrar(GET('hola'), {
      sesion: conSesion,
      env: ENV,
      fetch: fetchQueDevuelve('<html>boom</html>', { status: 500 }),
    });
    expect(r.status).toBe(502);
    const cuerpo = (await r.json()) as { error: { voz: { reintentable: boolean } } };
    expect(cuerpo.error.voz.reintentable).toBe(true);
  });

  it('si el fetch explota, sale 502 tipado y no una excepción', async () => {
    const r = await manejarNarrar(GET('hola'), {
      sesion: conSesion,
      env: ENV,
      fetch: (() => Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch,
    });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('PROVIDER_ERROR');
  });

  it('un timeout sale 504 y lo dice', async () => {
    const abortada = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const r = await manejarNarrar(GET('hola'), {
      sesion: conSesion,
      env: ENV,
      fetch: (() => Promise.reject(abortada)) as unknown as typeof fetch,
    });
    expect(r.status).toBe(504);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain('segundos');
  });

  it('un 200 sin cuerpo no se sirve como audio vacío', async () => {
    const r = await manejarNarrar(GET('hola'), {
      sesion: conSesion,
      env: ENV,
      fetch: (async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
    });
    expect(r.status).toBe(502);
  });
});
