/**
 * La caché de narración.
 *
 * Lo que se está probando no es «guarda y devuelve»: es que NO se convierta en
 * una fuga de memoria, y que lo que desaloje sea lo que ya nadie va a pedir.
 */
import { describe, expect, it } from 'vitest';
import { CacheDeNarracion, fraccionPorEntrada, TOPE_CACHE_BYTES } from './cache';

const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(1);

describe('CacheDeNarracion', () => {
  it('la clave lleva el texto entero, no un hash', () => {
    // Un hash abriría la puerta —remota pero real y silenciosa— a que un
    // invitado oiga la pregunta de otro. Eso no se diagnostica nunca.
    const clave = CacheDeNarracion.clave('¿Cómo se llama tu negocio?', 'ana', 'flash', 'mp3');
    expect(clave).toContain('¿Cómo se llama tu negocio?');
  });

  it('la misma frase con otra voz es otra entrada', () => {
    expect(CacheDeNarracion.clave('hola', 'ana', 'm', 'f')).not.toBe(
      CacheDeNarracion.clave('hola', 'cari', 'm', 'f'),
    );
  });

  it('la misma frase con otro modelo o formato también', () => {
    expect(CacheDeNarracion.clave('hola', 'ana', 'flash', 'mp3')).not.toBe(
      CacheDeNarracion.clave('hola', 'ana', 'turbo', 'mp3'),
    );
    expect(CacheDeNarracion.clave('hola', 'ana', 'flash', 'mp3_44100_128')).not.toBe(
      CacheDeNarracion.clave('hola', 'ana', 'flash', 'mp3_22050_32'),
    );
  });

  it('guarda y devuelve, contando aciertos y fallos', () => {
    const c = new CacheDeNarracion(1024);
    expect(c.obtener('a')).toBeUndefined();
    c.guardar('a', bytes(10), 'audio/mpeg');

    const e = c.obtener('a');
    expect(e?.bytes.byteLength).toBe(10);
    expect(e?.tipo).toBe('audio/mpeg');
    expect(c.estado()).toMatchObject({ entradas: 1, bytes: 10, aciertos: 1, fallos: 1 });
  });

  it('NUNCA pasa del tope de bytes', () => {
    const c = new CacheDeNarracion(800); // caben ocho de cien
    for (let i = 0; i < 50; i++) c.guardar(`k${i}`, bytes(100), 'audio/mpeg');
    expect(c.estado().bytes).toBeLessThanOrEqual(800);
    expect(c.estado().desalojos).toBeGreaterThan(0);
  });

  it('desaloja lo que hace más tiempo que nadie pide, no lo que se guardó antes', () => {
    // El tope por entrada es un octavo del total, así que la caché más pequeña
    // que puede existir guarda ocho cosas. Con ocho se llena exacto y la novena
    // obliga a desalojar: es el escenario real del guion del Ritual.
    const c = new CacheDeNarracion(800);
    for (let i = 1; i <= 8; i++) c.guardar(`k${i}`, bytes(100), 'audio/mpeg');
    expect(c.estado().entradas).toBe(8);

    // Se vuelve a pedir la primera: ahora es la más reciente.
    expect(c.obtener('k1')).toBeDefined();

    c.guardar('k9', bytes(100), 'audio/mpeg');

    expect(c.obtener('k1')).toBeDefined(); // sobrevivió por haberse usado
    expect(c.obtener('k2')).toBeUndefined(); // salió la que llevaba más sin pedirse
    expect(c.obtener('k9')).toBeDefined();
  });

  it('reemplazar una clave no cuenta dos veces sus bytes', () => {
    const c = new CacheDeNarracion(8000);
    c.guardar('a', bytes(100), 'audio/mpeg');
    c.guardar('a', bytes(200), 'audio/mpeg');
    expect(c.estado()).toMatchObject({ entradas: 1, bytes: 200 });
  });

  it('rechaza lo que ocuparía toda la caché, en vez de vaciarla para él solo', () => {
    // REGRESIÓN: el tope por entrada tiene que ser una fracción del tope de
    // ESTA caché, no la constante global. Con la constante, una caché de 800
    // bytes aceptaba una entrada de 500 —más de la mitad de todo lo que cabe—
    // porque la comparaba contra los 4 MB del tope por defecto, y la política
    // de desalojo dejaba de existir sin que nada lo dijera.
    const c = new CacheDeNarracion(800);
    expect(c.topePorEntrada).toBe(100);
    expect(c.guardar('gigante', bytes(500), 'audio/mpeg')).toBe(false);
    expect(c.estado().entradas).toBe(0);
  });

  it('el tope por entrada escala con el de la caché', () => {
    expect(new CacheDeNarracion(8000).topePorEntrada).toBe(1000);
    expect(fraccionPorEntrada(TOPE_CACHE_BYTES)).toBe(TOPE_CACHE_BYTES / 8);
  });

  it('no guarda nada vacío — un audio de 0 bytes no es un acierto', () => {
    const c = new CacheDeNarracion(1000);
    expect(c.guardar('vacio', bytes(0), 'audio/mpeg')).toBe(false);
    expect(c.obtener('vacio')).toBeUndefined();
  });

  it('el tope por defecto cabe en cualquier VPS', () => {
    expect(TOPE_CACHE_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  it('vaciar deja el contador de bytes en cero', () => {
    const c = new CacheDeNarracion(1000);
    c.guardar('a', bytes(100), 'audio/mpeg');
    c.vaciar();
    expect(c.estado()).toMatchObject({ entradas: 0, bytes: 0 });
  });
});
