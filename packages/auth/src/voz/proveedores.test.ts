/**
 * La traducción del «no» de cada proveedor.
 *
 * Los cuerpos de esta prueba NO están inventados: son los que devolvieron
 * ElevenLabs, OpenAI y Groq el 2026-08-01 contra las llaves de producción de
 * este ecosistema. Están copiados byte por byte de la salida real, y por eso
 * esta prueba vale: no comprueba lo que yo creo que contesta un proveedor, sino
 * lo que contestó.
 */
import { describe, expect, it } from 'vitest';
import {
  camposDeDictado,
  falloDeDictado,
  falloDeNarracion,
  IDIOMA_POR_DEFECTO,
  leerTranscripcion,
  peticionDeNarracion,
  tipoDeSalida,
} from './proveedores';
import { FalloDeVoz } from './errores';

const CONFIG = {
  llave: 'llave-de-prueba',
  vozId: 'voz-abc',
  voz: 'ana' as const,
  modelo: 'eleven_flash_v2_5',
  formato: 'mp3_44100_128',
};

// ── Cuerpos REALES, medidos el 2026-08-01 ───────────────────────────────────

/** ElevenLabs, POST /v1/text-to-speech/{voz}/stream → HTTP 401. */
const ELEVEN_SIN_PAGAR = JSON.stringify({
  detail: {
    type: 'payment_required',
    code: 'payment_issue',
    message:
      'Your subscription has a failed or incomplete payment. Complete the latest invoice to continue usage.',
    status: 'payment_issue',
    request_id: 'b14b04608de86920c8a2f441962fd5bf',
  },
});

/** OpenAI, POST /v1/audio/transcriptions → HTTP 429. */
const OPENAI_SIN_CREDITO = JSON.stringify({
  error: {
    message:
      'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
    type: 'insufficient_quota',
    param: null,
    code: 'credit_balance_exhausted',
  },
});

/** Groq, con el archivo SIN extensión → HTTP 400. */
const GROQ_SIN_EXTENSION = JSON.stringify({
  error: {
    message: 'file must be one of the following types: [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm]',
    type: 'invalid_request_error',
  },
});

describe('peticionDeNarracion', () => {
  it('pide el endpoint de STREAMING, no el normal', () => {
    // Sin `/stream` el audio se genera entero antes de salir, y el primer
    // sonido tarda lo que tarde la frase completa.
    const p = peticionDeNarracion(CONFIG, 'Hola');
    expect(p.url).toContain('/stream');
    expect(p.url).toContain('/v1/text-to-speech/voz-abc/');
    expect(p.url).toContain('output_format=mp3_44100_128');
  });

  it('manda la llave en su cabecera y nunca en la URL', () => {
    const p = peticionDeNarracion(CONFIG, 'Hola');
    expect(p.init.headers['xi-api-key']).toBe('llave-de-prueba');
    // Una llave en la URL acaba en el log de acceso de nginx.
    expect(p.url).not.toContain('llave-de-prueba');
  });

  it('escapa el id de la voz — nunca se concatena a la URL a pelo', () => {
    const p = peticionDeNarracion({ ...CONFIG, vozId: 'a/b?c=d' }, 'Hola');
    expect(p.url).toContain('a%2Fb%3Fc%3Dd');
  });

  it('lleva el texto y el modelo en el cuerpo', () => {
    const p = peticionDeNarracion(CONFIG, '¿Cómo se llama tu negocio?');
    const cuerpo = JSON.parse(p.init.body) as { text: string; model_id: string };
    expect(cuerpo.text).toBe('¿Cómo se llama tu negocio?');
    expect(cuerpo.model_id).toBe('eleven_flash_v2_5');
  });

  it('el content-type de la respuesta corresponde al formato', () => {
    expect(tipoDeSalida('mp3_44100_128')).toBe('audio/mpeg');
    expect(tipoDeSalida('opus_48000_64')).toBe('audio/ogg');
    expect(tipoDeSalida('pcm_16000')).toBe('audio/wave');
  });
});

describe('falloDeNarracion — ElevenLabs', () => {
  it('LA FACTURA SIN PAGAR sale como BUDGET_EXCEEDED, aunque llegue en un 401', () => {
    // Éste es el estado REAL de la cuenta hoy. Un 401 a secas se leería como
    // «la llave está mal» y alguien perdería una hora rotando llaves buenas.
    const f = falloDeNarracion(401, ELEVEN_SIN_PAGAR);
    expect(f.code).toBe('BUDGET_EXCEEDED');
    expect(f.status).toBe(402);
    expect(f.reintentable).toBe(false);
    expect(f.definitivo).toBe(true);
    expect(f.proveedor).toBe('elevenlabs');
    expect(f.message).toContain('pagar la factura');
    // Y nunca sale la llave en el mensaje.
    expect(f.message).not.toContain('llave-de-prueba');
  });

  it('una llave DE VERDAD inválida sí es PROVIDER_ERROR', () => {
    const f = falloDeNarracion(401, JSON.stringify({ detail: { status: 'invalid_api_key' } }));
    expect(f.code).toBe('PROVIDER_ERROR');
    expect(f.message).toContain('ELEVENLABS_API_KEY');
  });

  it('una voz borrada apunta a la variable que hay que revisar', () => {
    const f = falloDeNarracion(404, '{}');
    expect(f.message).toContain('ELEVENLABS_VOICE_ANA');
  });

  it('429 es reintentable; el crédito agotado no', () => {
    expect(falloDeNarracion(429, '{}').reintentable).toBe(true);
    expect(falloDeNarracion(429, JSON.stringify({ detail: { status: 'quota_exceeded' } })).code).toBe(
      'BUDGET_EXCEEDED',
    );
  });

  it('un cuerpo que no es JSON no revienta — sale el genérico con su status', () => {
    for (const basura of ['<html>502 Bad Gateway</html>', '', 'null']) {
      const f = falloDeNarracion(502, basura);
      expect(FalloDeVoz.es(f)).toBe(true);
      expect(f.code).toBe('PROVIDER_ERROR');
    }
  });

  it('la validación de FastAPI llega como lista y se lee igual', () => {
    const f = falloDeNarracion(422, JSON.stringify({ detail: [{ msg: 'text too long' }] }));
    expect(f.code).toBe('VALIDATION');
    expect(f.message).toContain('text too long');
  });
});

describe('falloDeDictado — Groq y OpenAI hablan el mismo dialecto', () => {
  it('OPENAI SIN CRÉDITO sale como BUDGET_EXCEEDED, no como RATE_LIMITED', () => {
    // Es el requisito literal: «un 429 tiene que salir como error tipado y
    // distinguible, no como falló la transcripción». Los dos llegan como 429 y
    // sólo el cuerpo dice cuál es.
    const f = falloDeDictado('openai', 429, OPENAI_SIN_CREDITO);
    expect(f.code).toBe('BUDGET_EXCEEDED');
    expect(f.status).toBe(402);
    expect(f.reintentable).toBe(false);
    expect(f.definitivo).toBe(true);
    expect(f.message).toContain('sin crédito');
  });

  it('un 429 DE VERDAD por ritmo sí es RATE_LIMITED y sí se reintenta', () => {
    const f = falloDeDictado(
      'groq',
      429,
      JSON.stringify({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }),
    );
    expect(f.code).toBe('RATE_LIMITED');
    expect(f.reintentable).toBe(true);
    expect(f.definitivo).toBe(false);
  });

  it('el archivo sin extensión llega con el diagnóstico del proveedor intacto', () => {
    const f = falloDeDictado('groq', 400, GROQ_SIN_EXTENSION);
    expect(f.code).toBe('VALIDATION');
    expect(f.message).toContain('file must be one of the following types');
  });

  it('una llave rechazada nombra al proveedor', () => {
    const f = falloDeDictado('groq', 401, '{}');
    expect(f.code).toBe('PROVIDER_ERROR');
    expect(f.message).toContain('groq');
  });

  it('un cuerpo en HTML no revienta', () => {
    expect(falloDeDictado('groq', 502, '<html>').code).toBe('PROVIDER_ERROR');
  });
});

describe('camposDeDictado', () => {
  it('el idioma va EXPLÍCITO en español', () => {
    // Whisper detecta el idioma solo y en audios cortos lo detecta mal: tres
    // palabras en español salen en portugués con total seguridad.
    const c = camposDeDictado({ proveedor: 'groq', llave: 'x', url: 'u', modelo: 'm' });
    expect(c.idioma).toBe('es');
    expect(IDIOMA_POR_DEFECTO).toBe('es');
  });

  it('un idioma en blanco vuelve al español', () => {
    const c = camposDeDictado(
      { proveedor: 'groq', llave: 'x', url: 'u', modelo: 'm' },
      { idioma: '  ' },
    );
    expect(c.idioma).toBe('es');
  });
});

describe('leerTranscripcion', () => {
  it('devuelve el texto recortado — Whisper lo entrega con un espacio delante', () => {
    // Medido: {"text":" Mi negocio organiza eventos…"}
    expect(leerTranscripcion(JSON.stringify({ text: ' Mi negocio organiza eventos.' }))).toBe(
      'Mi negocio organiza eventos.',
    );
  });

  it('un 200 con silencio se DICE, no se manda vacío al agente', () => {
    try {
      leerTranscripcion(JSON.stringify({ text: '   ' }));
      expect.unreachable('tenía que fallar');
    } catch (e) {
      expect((e as FalloDeVoz).code).toBe('VALIDATION');
      expect((e as FalloDeVoz).message).toContain('No se oyó nada');
    }
  });

  it('un 200 que no es JSON, o sin `text`, es un fallo del proveedor', () => {
    expect(() => leerTranscripcion('<html>')).toThrow(FalloDeVoz);
    expect(() => leerTranscripcion('{}')).toThrow(FalloDeVoz);
    expect(() => leerTranscripcion(JSON.stringify({ text: 42 }))).toThrow(FalloDeVoz);
  });
});
