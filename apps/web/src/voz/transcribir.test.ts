/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El handler de TRANSCRIBIR, entero, sin red y sin gastar un centavo.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Los tres casos que más importan y que no son hipótesis:
 *
 *   · un anónimo no sube un solo byte al proveedor (la factura ajena)
 *   · el archivo llega SIEMPRE con extensión (medido: sin ella, 400 de Groq)
 *   · el 429 de OpenAI sin crédito sale distinguible del 429 por ritmo
 */
import { describe, expect, it, vi } from 'vitest';
import { manejarTranscribir } from './servidor/transcribir';
import type { QuienEntra } from './servidor/sesion';

const INVITADO: QuienEntra = { correo: 'invitado@ejemplo.com', empresa: null };
const conSesion = async (): Promise<QuienEntra | null> => INVITADO;
const sinSesion = async (): Promise<QuienEntra | null> => null;

const CON_GROQ = { GROQ_API_KEY: 'llave-de-groq' };
const CON_OPENAI = { OPENAI_API_KEY: 'llave-de-openai' };
const CON_LAS_DOS = { ...CON_GROQ, ...CON_OPENAI };

const URL_BASE = 'https://mi.abraxa.club/voz/api/transcribir';

function peticionConAudio(
  bytes: Uint8Array,
  tipo: string,
  extra?: Record<string, string>,
  url = URL_BASE,
): Request {
  const formulario = new FormData();
  formulario.append('audio', new Blob([bytes as unknown as BlobPart], { type: tipo }), 'grabacion');
  for (const [k, v] of Object.entries(extra ?? {})) formulario.append(k, v);
  return new Request(url, { method: 'POST', body: formulario });
}

const AUDIO = new Uint8Array(2048).fill(7);

function fetchQueDevuelve(cuerpo: string, init: ResponseInit = {}): typeof globalThis.fetch {
  return vi.fn(async () => new Response(cuerpo, init)) as unknown as typeof fetch;
}

const OK = JSON.stringify({ text: ' Organizo eventos de networking.' });

// ═══════════════════════════════════════════════════════════════════════════

describe('transcribir — la puerta', () => {
  it('un ANÓNIMO recibe 401 y NO se sube un solo byte', async () => {
    const hacerFetch = fetchQueDevuelve(OK);
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: sinSesion,
      env: CON_LAS_DOS,
      fetch: hacerFetch,
    });

    expect(r.status).toBe(401);
    expect(hacerFetch).not.toHaveBeenCalled();
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('un invitado sin empresa sí puede dictar', async () => {
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: async () => ({ correo: 'nuevo@ejemplo.com', empresa: null }),
      env: CON_GROQ,
      fetch: fetchQueDevuelve(OK),
    });
    expect(r.status).toBe(200);
  });
});

describe('transcribir — el camino bueno', () => {
  it('devuelve el texto, el proveedor y lo que tardó', async () => {
    let t = 1000;
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: fetchQueDevuelve(OK),
      ahora: () => (t += 376), // el tiempo REAL medido contra Groq
    });

    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      texto: 'Organizo eventos de networking.',
      proveedor: 'groq',
      modelo: 'whisper-large-v3',
      ms: 376,
      bytes: 2048,
      formato: 'audio/webm',
    });
  });

  it('EL ARCHIVO SIEMPRE LLEVA EXTENSIÓN — es lo que mata el dictado si falta', async () => {
    // Medido el 2026-08-01: el mismo webm llamado `audio` da 400 de Groq
    // («file must be one of the following types») en 90 ms. Y `blob` es
    // exactamente lo que manda un FormData sin nombre.
    const hacerFetch = vi.fn(async () => new Response(OK)) as unknown as typeof fetch;

    await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm;codecs=opus'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: hacerFetch,
    });

    const [, init] = (hacerFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] ?? ([] as never);
    const enviado = (init.body as FormData).get('file');
    expect(enviado).toBeInstanceOf(File);
    expect((enviado as File).name).toBe('audio.webm');
  });

  it('el mp4 de Safari sube como .m4a — es el formato de todos los iPhone', async () => {
    const hacerFetch = vi.fn(async () => new Response(OK)) as unknown as typeof fetch;
    await manejarTranscribir(peticionConAudio(AUDIO, 'audio/mp4'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: hacerFetch,
    });
    const [, init] = (hacerFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] ?? ([] as never);
    expect(((init.body as FormData).get('file') as File).name).toBe('audio.m4a');
  });

  it('el idioma va explícito en español', async () => {
    const hacerFetch = vi.fn(async () => new Response(OK)) as unknown as typeof fetch;
    await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: hacerFetch,
    });
    const [, init] = (hacerFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] ?? ([] as never);
    expect((init.body as FormData).get('language')).toBe('es');
    expect((init.body as FormData).get('model')).toBe('whisper-large-v3');
  });

  it('acepta un contexto para sesgar el vocabulario', async () => {
    const hacerFetch = vi.fn(async () => new Response(OK)) as unknown as typeof fetch;
    await manejarTranscribir(
      peticionConAudio(AUDIO, 'audio/webm', { contexto: 'Cariñeeto, Inperio, ABRAXA' }),
      { sesion: conSesion, env: CON_GROQ, fetch: hacerFetch },
    );
    const [, init] = (hacerFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] ?? ([] as never);
    expect((init.body as FormData).get('prompt')).toBe('Cariñeeto, Inperio, ABRAXA');
  });

  it('la llave viaja en la cabecera y NUNCA en la URL', async () => {
    const hacerFetch = vi.fn(async () => new Response(OK)) as unknown as typeof fetch;
    await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: hacerFetch,
    });
    const [url, init] = (hacerFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] ?? ([] as never);
    expect(url).not.toContain('llave-de-groq');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer llave-de-groq');
    // El content-type del multipart lo pone `fetch` con su boundary. Escribirlo
    // a mano rompe el envoltorio de una forma que el proveedor reporta como
    // «archivo corrupto».
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('acepta el cuerpo CRUDO, para un curl de diagnóstico', async () => {
    const r = await manejarTranscribir(
      new Request(URL_BASE, {
        method: 'POST',
        headers: { 'content-type': 'audio/mp4' },
        body: AUDIO,
      }),
      { sesion: conSesion, env: CON_GROQ, fetch: fetchQueDevuelve(OK) },
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as { formato: string }).formato).toBe('audio/mp4');
  });

  it('acepta el campo `file` además de `audio`', async () => {
    const formulario = new FormData();
    formulario.append('file', new Blob([AUDIO], { type: 'audio/webm' }), 'x');
    const r = await manejarTranscribir(
      new Request(URL_BASE, { method: 'POST', body: formulario }),
      { sesion: conSesion, env: CON_GROQ, fetch: fetchQueDevuelve(OK) },
    );
    expect(r.status).toBe(200);
  });
});

describe('transcribir — agnóstico de proveedor', () => {
  it('con las dos llaves va por GROQ', async () => {
    const hacerFetch = vi.fn(async () => new Response(OK)) as unknown as typeof fetch;
    await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_LAS_DOS,
      fetch: hacerFetch,
    });
    const [url] = (hacerFetch as unknown as { mock: { calls: [string][] } }).mock.calls[0] ?? ([] as never);
    expect(url).toContain('api.groq.com');
  });

  it('SIN la de Groq sigue funcionando por OpenAI — el requisito literal', async () => {
    const hacerFetch = vi.fn(async () => new Response(OK)) as unknown as typeof fetch;
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_OPENAI,
      fetch: hacerFetch,
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { proveedor: string }).proveedor).toBe('openai');
    const [url] = (hacerFetch as unknown as { mock: { calls: [string][] } }).mock.calls[0] ?? ([] as never);
    expect(url).toContain('api.openai.com');
  });

  it('sin ninguna llave: 501 definitivo, con las dos variables', async () => {
    const hacerFetch = fetchQueDevuelve(OK);
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: {},
      fetch: hacerFetch,
    });
    expect(r.status).toBe(501);
    expect(hacerFetch).not.toHaveBeenCalled();
    const cuerpo = (await r.json()) as { error: { message: string; voz: { definitivo: boolean } } };
    expect(cuerpo.error.message).toContain('GROQ_API_KEY');
    expect(cuerpo.error.voz.definitivo).toBe(true);
  });

  it('`?proveedor=openai` fuerza el respaldo, para poder comprobarlo en vivo', async () => {
    const hacerFetch = vi.fn(async () => new Response(OK)) as unknown as typeof fetch;
    await manejarTranscribir(
      peticionConAudio(AUDIO, 'audio/webm', undefined, `${URL_BASE}?proveedor=openai`),
      { sesion: conSesion, env: CON_LAS_DOS, fetch: hacerFetch },
    );
    const [url] = (hacerFetch as unknown as { mock: { calls: [string][] } }).mock.calls[0] ?? ([] as never);
    expect(url).toContain('api.openai.com');
  });

  it('un `?proveedor=` inventado se ignora en vez de dejar sin dictar', async () => {
    const r = await manejarTranscribir(
      peticionConAudio(AUDIO, 'audio/webm', undefined, `${URL_BASE}?proveedor=deepgram`),
      { sesion: conSesion, env: CON_GROQ, fetch: fetchQueDevuelve(OK) },
    );
    expect(r.status).toBe(200);
  });
});

describe('transcribir — los topes', () => {
  it('rechaza por `content-length` ANTES de leer el cuerpo', async () => {
    const hacerFetch = fetchQueDevuelve(OK);
    const r = await manejarTranscribir(
      new Request(URL_BASE, {
        method: 'POST',
        headers: { 'content-type': 'audio/webm', 'content-length': String(30 * 1024 * 1024) },
        body: new Uint8Array(16),
      }),
      { sesion: conSesion, env: CON_GROQ, fetch: hacerFetch },
    );
    expect(r.status).toBe(422);
    expect(hacerFetch).not.toHaveBeenCalled();
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain('15 MB');
  });

  it('un audio vacío se dice, y no se sube', async () => {
    const hacerFetch = fetchQueDevuelve(OK);
    const r = await manejarTranscribir(peticionConAudio(new Uint8Array(0), 'audio/webm'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: hacerFetch,
    });
    expect(r.status).toBe(422);
    expect(hacerFetch).not.toHaveBeenCalled();
  });

  it('un formulario sin el campo `audio` se dice claro', async () => {
    const formulario = new FormData();
    formulario.append('otra_cosa', 'x');
    const r = await manejarTranscribir(
      new Request(URL_BASE, { method: 'POST', body: formulario }),
      { sesion: conSesion, env: CON_GROQ, fetch: fetchQueDevuelve(OK) },
    );
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain('audio');
  });

  it('un GET no transcribe nada', async () => {
    const r = await manejarTranscribir(new Request(URL_BASE), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: fetchQueDevuelve(OK),
    });
    expect(r.status).toBe(422);
  });
});

describe('transcribir — cuando el proveedor dice que no', () => {
  it('OPENAI SIN CRÉDITO sale 402 definitivo, distinguible de un 429 por ritmo', async () => {
    // Cuerpo REAL, medido el 2026-08-01 contra la llave de este ecosistema.
    const sinCredito = JSON.stringify({
      error: {
        message: 'You have no credits remaining.',
        type: 'insufficient_quota',
        code: 'credit_balance_exhausted',
      },
    });

    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_OPENAI,
      fetch: fetchQueDevuelve(sinCredito, { status: 429 }),
    });

    expect(r.status).toBe(402);
    const cuerpo = (await r.json()) as {
      error: { code: string; voz: { reintentable: boolean; definitivo: boolean } };
    };
    expect(cuerpo.error.code).toBe('BUDGET_EXCEEDED');
    expect(cuerpo.error.voz.reintentable).toBe(false);
    expect(cuerpo.error.voz.definitivo).toBe(true);
  });

  it('un 429 por ritmo SÍ es reintentable', async () => {
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: fetchQueDevuelve(
        JSON.stringify({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }),
        { status: 429 },
      ),
    });
    expect(r.status).toBe(429);
    const cuerpo = (await r.json()) as { error: { code: string; voz: { reintentable: boolean } } };
    expect(cuerpo.error.code).toBe('RATE_LIMITED');
    expect(cuerpo.error.voz.reintentable).toBe(true);
  });

  it('el diagnóstico del proveedor llega intacto cuando es útil', async () => {
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: fetchQueDevuelve(
        JSON.stringify({
          error: {
            message: 'file must be one of the following types: [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm]',
            type: 'invalid_request_error',
          },
        }),
        { status: 400 },
      ),
    });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain(
      'file must be one of',
    );
  });

  it('un timeout sale 504 y dice que se puede escribir', async () => {
    const seAgoto = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: (() => Promise.reject(seAgoto)) as unknown as typeof fetch,
    });
    expect(r.status).toBe(504);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain('Escribe');
  });

  it('el silencio se dice, no se manda vacío al agente', async () => {
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: conSesion,
      env: CON_GROQ,
      fetch: fetchQueDevuelve(JSON.stringify({ text: '  ' })),
    });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain(
      'No se oyó nada',
    );
  });

  it('nunca sale un 500 desnudo: lo inesperado es 502 tipado', async () => {
    const r = await manejarTranscribir(peticionConAudio(AUDIO, 'audio/webm'), {
      sesion: () => {
        throw new Error('algo raro en la sesión');
      },
      env: CON_GROQ,
      fetch: fetchQueDevuelve(OK),
    });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('PROVIDER_ERROR');
  });
});
