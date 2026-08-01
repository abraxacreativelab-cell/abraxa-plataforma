/**
 * Las llaves de la voz.
 *
 * El caso que de verdad se está probando aquí es el del requisito: «el código
 * tiene que funcionar CON o SIN la llave de Groq». Se prueba con las cuatro
 * combinaciones, no con la feliz.
 *
 * Ni una sola prueba escribe en `process.env`: el entorno entra como argumento.
 */
import { describe, expect, it } from 'vitest';
import {
  configDeDictado,
  configDeNarracion,
  diagnosticoDeVoz,
  hayDictado,
  hayNarracion,
  MODELO_POR_DEFECTO,
  VOZ_POR_DEFECTO,
  vozValida,
} from './entorno';
import { FalloDeVoz } from './errores';

const COMPLETO = {
  ELEVENLABS_API_KEY: 'llave-de-prueba',
  ELEVENLABS_VOICE_ANA: 'voz-ana',
  ELEVENLABS_VOICE_CARI: 'voz-cari',
  GROQ_API_KEY: 'llave-de-prueba',
  OPENAI_API_KEY: 'llave-de-prueba',
};

describe('configDeNarracion', () => {
  it('arma la voz por defecto con el modelo de menor latencia', () => {
    const c = configDeNarracion(undefined, COMPLETO);
    expect(c.voz).toBe(VOZ_POR_DEFECTO);
    expect(c.voz).toBe('ana'); // el Ritual es una entrevista: voz cálida.
    expect(c.vozId).toBe('voz-ana');
    expect(c.modelo).toBe(MODELO_POR_DEFECTO);
  });

  it('deja elegir la segunda voz', () => {
    expect(configDeNarracion('cari', COMPLETO).vozId).toBe('voz-cari');
  });

  it('deja cambiar el modelo desde el VPS sin tocar código', () => {
    const c = configDeNarracion('ana', { ...COMPLETO, ELEVENLABS_MODEL: 'eleven_turbo_v2_5' });
    expect(c.modelo).toBe('eleven_turbo_v2_5');
  });

  it('sin llave falla con PORT_NOT_IMPLEMENTED y nombra la variable', () => {
    try {
      configDeNarracion('ana', { ...COMPLETO, ELEVENLABS_API_KEY: undefined });
      expect.unreachable('tenía que fallar');
    } catch (e) {
      expect(FalloDeVoz.es(e)).toBe(true);
      const f = e as FalloDeVoz;
      expect(f.code).toBe('PORT_NOT_IMPLEMENTED');
      expect(f.definitivo).toBe(true); // el cliente apaga la voz y no reintenta.
      expect(f.message).toContain('ELEVENLABS_API_KEY');
    }
  });

  it('una variable EN BLANCO cuenta como ausente', () => {
    // `ELEVENLABS_API_KEY=` en un .env es lo que deja alguien a medio configurar.
    // Si contara como presente, se mandaría una cabecera vacía y el 401 se
    // leería como «ElevenLabs está caído».
    expect(() => configDeNarracion('ana', { ...COMPLETO, ELEVENLABS_API_KEY: '   ' })).toThrow(
      FalloDeVoz,
    );
  });

  it('con llave pero sin id de voz dice CUÁL variable falta', () => {
    try {
      configDeNarracion('ana', { ...COMPLETO, ELEVENLABS_VOICE_ANA: '' });
      expect.unreachable('tenía que fallar');
    } catch (e) {
      expect((e as FalloDeVoz).message).toContain('ELEVENLABS_VOICE_ANA');
    }
  });

  it('hayNarracion no lanza y no llama a nadie', () => {
    expect(hayNarracion('ana', COMPLETO)).toBe(true);
    expect(hayNarracion('ana', {})).toBe(false);
  });
});

describe('vozValida', () => {
  it('cualquier cosa rara del navegador cae en la voz de siempre', () => {
    expect(vozValida('cari')).toBe('cari');
    expect(vozValida('ana')).toBe('ana');
    for (const raro of ['ANA', 'otra', '', null, undefined, 42, {}, ['ana']]) {
      expect(vozValida(raro)).toBe(VOZ_POR_DEFECTO);
    }
  });
});

describe('configDeDictado — agnóstico de proveedor', () => {
  it('con las dos llaves elige GROQ, que es medio segundo más rápido', () => {
    const c = configDeDictado(COMPLETO);
    expect(c.proveedor).toBe('groq');
    expect(c.modelo).toBe('whisper-large-v3');
    expect(c.url).toContain('api.groq.com');
  });

  it('SIN la llave de Groq cae a OpenAI y sigue funcionando', () => {
    const c = configDeDictado({ ...COMPLETO, GROQ_API_KEY: undefined });
    expect(c.proveedor).toBe('openai');
    expect(c.modelo).toBe('whisper-1');
    expect(c.url).toContain('api.openai.com');
  });

  it('con SÓLO la llave de Groq no necesita a OpenAI para nada', () => {
    const c = configDeDictado({ GROQ_API_KEY: 'x' });
    expect(c.proveedor).toBe('groq');
  });

  it('sin ninguna de las dos falla nombrando LAS DOS variables', () => {
    try {
      configDeDictado({});
      expect.unreachable('tenía que fallar');
    } catch (e) {
      const f = e as FalloDeVoz;
      expect(f.code).toBe('PORT_NOT_IMPLEMENTED');
      expect(f.message).toContain('GROQ_API_KEY');
      expect(f.message).toContain('OPENAI_API_KEY');
    }
  });

  it('forzar un proveedor sin llave falla con SU nombre, no cae al otro', () => {
    // Un respaldo silencioso convierte «Groq está mal configurado» en «Groq va
    // lento», y eso se diagnostica en horas en vez de en segundos.
    try {
      configDeDictado({ OPENAI_API_KEY: 'x' }, 'groq');
      expect.unreachable('tenía que fallar');
    } catch (e) {
      expect((e as FalloDeVoz).message).toContain('GROQ_API_KEY');
      expect((e as FalloDeVoz).message).not.toContain('OPENAI');
    }
  });

  it('hayDictado con cualquiera de las dos', () => {
    expect(hayDictado({ GROQ_API_KEY: 'x' })).toBe(true);
    expect(hayDictado({ OPENAI_API_KEY: 'x' })).toBe(true);
    expect(hayDictado({})).toBe(false);
    expect(hayDictado({ GROQ_API_KEY: '' })).toBe(false);
  });
});

describe('diagnosticoDeVoz', () => {
  it('con todo puesto está listo y sin advertencias', () => {
    const d = diagnosticoDeVoz(COMPLETO);
    expect(d.listo).toBe(true);
    expect(d.faltantes).toEqual([]);
    expect(d.advertencias).toEqual([]);
    expect(d.narracion.voces).toEqual(['ana', 'cari']);
    expect(d.dictado.proveedor).toBe('groq');
  });

  it('sin nada, cada faltante nombra su variable y su consecuencia', () => {
    const d = diagnosticoDeVoz({});
    expect(d.listo).toBe(false);
    expect(d.faltantes.join(' ')).toContain('ELEVENLABS_API_KEY');
    expect(d.faltantes.join(' ')).toContain('GROQ_API_KEY');
    // La consecuencia, no sólo el nombre.
    expect(d.faltantes.join(' ')).toContain('no habla');
    // Y la razón por la que el navegador no sirve de respaldo.
    expect(d.faltantes.join(' ')).toContain('iPhone');
  });

  it('sin Groq avisa que se va a sentir, pero no bloquea', () => {
    const d = diagnosticoDeVoz({ ...COMPLETO, GROQ_API_KEY: undefined });
    expect(d.listo).toBe(true);
    expect(d.dictado.listo).toBe(true);
    expect(d.advertencias.join(' ')).toContain('GROQ_API_KEY');
  });

  it('con llave de ElevenLabs pero sin ninguna voz, lo dice aparte', () => {
    const d = diagnosticoDeVoz({
      ELEVENLABS_API_KEY: 'x',
      GROQ_API_KEY: 'x',
    });
    expect(d.narracion.listo).toBe(false);
    expect(d.faltantes.join(' ')).toContain('ELEVENLABS_VOICE_ANA');
  });

  it('con sólo la voz que NO es la del Ritual, advierte', () => {
    const d = diagnosticoDeVoz({ ...COMPLETO, ELEVENLABS_VOICE_ANA: undefined });
    expect(d.narracion.listo).toBe(true);
    expect(d.advertencias.join(' ')).toContain('ELEVENLABS_VOICE_ANA');
  });
});
