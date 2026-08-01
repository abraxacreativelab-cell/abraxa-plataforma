/**
 * Los topes y la extensión del archivo.
 *
 * La prueba de la extensión no es teórica. El 2026-08-01, contra Groq y con el
 * MISMO webm/opus, medido:
 *
 *   `audio.webm` → 200 en 447 ms   ·   `audio` → 400 en 90 ms
 *
 * O sea: el camino por defecto de cualquiera —`FormData.append('file', blob)`,
 * que manda el nombre `blob`— falla, y el mensaje del proveedor no menciona la
 * palabra «nombre» por ningún lado. Esta prueba es lo que impide que ese bug
 * vuelva.
 */
import { describe, expect, it } from 'vitest';
import {
  extensionDeAudio,
  nombreDeArchivo,
  revisarAudio,
  revisarTexto,
  tipoBase,
  TOPE_AUDIO_BYTES,
  TOPE_TEXTO,
  TOPE_TEXTO_EN_URL,
} from './audio';
import { FalloDeVoz } from './errores';

describe('extensión del archivo — la trampa medida', () => {
  it('el nombre NUNCA sale sin extensión', () => {
    for (const mime of ['audio/webm;codecs=opus', 'audio/mp4', '', undefined, null, 'basura/x']) {
      expect(nombreDeArchivo(mime)).toMatch(/^audio\.[a-z0-9]+$/);
    }
  });

  it('los dos formatos que llegan de verdad', () => {
    // Chrome y Android. Medido contra Groq: 200 en 447 ms.
    expect(extensionDeAudio('audio/webm;codecs=opus')).toBe('webm');
    // Safari, y por lo tanto TODOS los iPhone. Medido: 200 en 376 ms.
    expect(extensionDeAudio('audio/mp4')).toBe('m4a');
  });

  it('ignora los parámetros y las mayúsculas del MIME', () => {
    expect(tipoBase('Audio/WEBM;codecs=opus')).toBe('audio/webm');
    expect(extensionDeAudio('AUDIO/MP4; codecs="mp4a.40.2"')).toBe('m4a');
  });

  it('un MIME desconocido cae a webm en vez de fallar', () => {
    // El proveedor sniffea el contenido de todos modos (medido: un webm
    // llamado `.wav` transcribe perfecto). Fallar aquí convertiría «el
    // navegador etiquetó raro» en «no se pudo transcribir», que es mentira.
    expect(extensionDeAudio('application/octet-stream')).toBe('webm');
    expect(extensionDeAudio('')).toBe('webm');
  });

  it('cubre lo que aceptan Groq y OpenAI', () => {
    const aceptados = ['flac', 'mp3', 'mp4', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm'];
    for (const mime of [
      'audio/flac',
      'audio/mpeg',
      'audio/mp4',
      'audio/ogg',
      'audio/opus',
      'audio/wav',
      'audio/webm',
    ]) {
      expect(aceptados).toContain(extensionDeAudio(mime));
    }
  });
});

describe('revisarAudio', () => {
  it('un audio vacío se dice como lo que es', () => {
    try {
      revisarAudio(0, 'audio/webm');
      expect.unreachable('tenía que fallar');
    } catch (e) {
      expect((e as FalloDeVoz).code).toBe('VALIDATION');
      expect((e as FalloDeVoz).message).toContain('otra vez');
    }
  });

  it('el tope está por DEBAJO de los 25 MB de nginx', () => {
    // Para que el 413 sea NUESTRO, en JSON tipado, y no la página HTML de
    // nginx que revienta el `await r.json()` del cliente.
    expect(TOPE_AUDIO_BYTES).toBeLessThan(25 * 1024 * 1024);
  });

  it('pasarse del tope dice cuánto pesaba y cuánto cabe', () => {
    try {
      revisarAudio(TOPE_AUDIO_BYTES + 1, 'audio/webm');
      expect.unreachable('tenía que fallar');
    } catch (e) {
      expect((e as FalloDeVoz).code).toBe('VALIDATION');
      expect((e as FalloDeVoz).message).toContain('15 MB');
    }
  });

  it('justo en el tope pasa', () => {
    expect(() => revisarAudio(TOPE_AUDIO_BYTES, 'audio/webm')).not.toThrow();
  });
});

describe('revisarTexto', () => {
  it('colapsa saltos de línea — si no, suena a alguien leyendo un documento', () => {
    expect(revisarTexto('  Hola.\n\n  ¿Cómo\tse llama\n tu negocio?  ')).toBe(
      'Hola. ¿Cómo se llama tu negocio?',
    );
  });

  it('vacío y sólo-espacios fallan igual', () => {
    for (const malo of ['', '   ', '\n\n', '\t']) {
      expect(() => revisarTexto(malo)).toThrow(FalloDeVoz);
    }
  });

  it('lo que no es cadena falla con VALIDATION, no con TypeError', () => {
    for (const malo of [undefined, null, 42, {}, []]) {
      try {
        revisarTexto(malo);
        expect.unreachable('tenía que fallar');
      } catch (e) {
        expect(FalloDeVoz.es(e)).toBe(true);
        expect((e as FalloDeVoz).code).toBe('VALIDATION');
      }
    }
  });

  it('el tope de la URL es más bajo que el de POST, y el mensaje dice adónde ir', () => {
    expect(TOPE_TEXTO_EN_URL).toBeLessThan(TOPE_TEXTO);
    try {
      revisarTexto('a'.repeat(TOPE_TEXTO_EN_URL + 1), TOPE_TEXTO_EN_URL);
      expect.unreachable('tenía que fallar');
    } catch (e) {
      expect((e as FalloDeVoz).message).toContain('POST');
    }
  });

  it('el tope de la URL cabe en la línea de petición de nginx (8 KB)', () => {
    // Peor caso: cada carácter se escapa a 9 bytes (`’` → `%E2%80%99`), más la
    // ruta y el resto de los parámetros. `large_client_header_buffers 4 8k`.
    expect(TOPE_TEXTO_EN_URL * 9 + 256).toBeLessThan(8 * 1024);
  });
});
