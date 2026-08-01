/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El cliente de navegador, probado sin navegador.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Se le inyecta un `Navegador` falso —seis métodos, ver `navegador.ts`— y se
 *  comprueban las cuatro cosas que sólo se descubren en un dispositivo de
 *  verdad y siempre en el peor momento:
 *
 *   1. que en un Safari de iPhone se elija `audio/mp4` y en un Chrome
 *      `audio/webm;codecs=opus`
 *   2. que `callar()` de verdad ABANDONE la descarga, no sólo el sonido
 *   3. que el micrófono se SUELTE siempre — pase lo que pase, incluso al fallar
 *   4. que un permiso denegado salga con un motivo tipado y un mensaje digno
 */
import { describe, expect, it, vi } from 'vitest';
import { crearVoz, mejorFormato, SinMicrofono, SILENCIO } from './cliente';
import { FalloDeVoz } from '../../../../packages/auth/src/voz/errores';
import type {
  ElementoDeAudio,
  GrabadoraMinima,
  Navegador,
  StreamMinimo,
} from './navegador';

// ═══════════════════════════════════════════════════════════════════════════
//  Los dobles
// ═══════════════════════════════════════════════════════════════════════════

class AudioFalso implements ElementoDeAudio {
  src = '';
  preload = '';
  autoplay = false;
  pausas = 0;
  cargas = 0;
  quitados: string[] = [];
  reproducciones: string[] = [];
  /** Qué hace `play()`. Por defecto, funciona. */
  alReproducir: () => Promise<void> = async () => {};

  private oyentes = new Map<string, Set<() => void>>();

  async play(): Promise<void> {
    this.reproducciones.push(this.src);
    await this.alReproducir();
  }
  pause(): void {
    this.pausas += 1;
  }
  load(): void {
    this.cargas += 1;
  }
  removeAttribute(nombre: string): void {
    this.quitados.push(nombre);
    if (nombre === 'src') this.src = '';
  }
  addEventListener(tipo: string, oyente: () => void): void {
    if (!this.oyentes.has(tipo)) this.oyentes.set(tipo, new Set());
    this.oyentes.get(tipo)!.add(oyente);
  }
  removeEventListener(tipo: string, oyente: () => void): void {
    this.oyentes.get(tipo)?.delete(oyente);
  }
  emitir(tipo: string): void {
    for (const o of [...(this.oyentes.get(tipo) ?? [])]) o();
  }
}

class GrabadoraFalsa implements GrabadoraMinima {
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  intervalos: number[] = [];

  constructor(readonly mimeType: string) {}

  start(intervaloMs?: number): void {
    this.state = 'recording';
    if (intervaloMs !== undefined) this.intervalos.push(intervaloMs);
  }
  stop(): void {
    this.state = 'inactive';
    this.onstop?.();
  }
  /** Simula un trozo de audio llegando desde el micrófono. */
  emitirDatos(tamano: number): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(tamano)], { type: this.mimeType }) });
  }
}

interface Guion {
  formatos?: readonly string[] | null;
  seguro?: boolean;
  microfono?: () => Promise<StreamMinimo>;
  respuesta?: () => Promise<Response>;
}

function navegadorFalso(guion: Guion = {}): {
  nav: Navegador;
  audio: AudioFalso;
  grabadoras: GrabadoraFalsa[];
  pistasVivas: () => number;
  peticiones: { url: string; init?: RequestInit }[];
  urlsVivas: () => number;
} {
  const audio = new AudioFalso();
  const grabadoras: GrabadoraFalsa[] = [];
  const peticiones: { url: string; init?: RequestInit }[] = [];
  let pistas = 0;
  const urls = new Set<string>();
  let n = 0;

  const soportados = guion.formatos === undefined ? ['audio/webm;codecs=opus'] : guion.formatos;

  const nav: Navegador = {
    fetch: (async (url: string, init?: RequestInit) => {
      peticiones.push({ url: String(url), init });
      return guion.respuesta ? guion.respuesta() : new Response(new Uint8Array([1, 2, 3]));
    }) as unknown as typeof fetch,

    contextoSeguro: () => guion.seguro !== false,

    formatoSoportado: (mime) => (soportados === null ? null : soportados.includes(mime)),

    pedirMicrofono: guion.microfono
      ? guion.microfono
      : async () => {
          pistas += 1;
          return {
            getTracks: () => [
              {
                stop: () => {
                  pistas -= 1;
                },
              },
            ],
          };
        },

    crearGrabadora: (_stream, opciones) => {
      const g = new GrabadoraFalsa(opciones.mimeType ?? 'audio/mp4');
      grabadoras.push(g);
      return g;
    },

    crearAudio: () => audio,
    urlDeObjeto: () => {
      n += 1;
      const u = `blob:falso/${n}`;
      urls.add(u);
      return u;
    },
    revocarUrl: (u) => {
      urls.delete(u);
    },
    ahora: () => 1_000,
  };

  return { nav, audio, grabadoras, pistasVivas: () => pistas, peticiones, urlsVivas: () => urls.size };
}

/** Espera a que algo ocurra sin adivinar cuántos microtasks hacen falta. */
async function hasta(condicion: () => boolean, vueltas = 200): Promise<void> {
  for (let i = 0; i < vueltas; i++) {
    if (condicion()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('la condición no se cumplió a tiempo');
}

// ═══════════════════════════════════════════════════════════════════════════
//  1 · El formato de grabación
// ═══════════════════════════════════════════════════════════════════════════

describe('el formato — es lo que distingue un iPhone de un Chrome', () => {
  it('Chrome graba webm/opus', () => {
    const { nav } = navegadorFalso({ formatos: ['audio/webm;codecs=opus', 'audio/webm'] });
    expect(mejorFormato(nav)).toBe('audio/webm;codecs=opus');
  });

  it('Safari de iPhone graba mp4 — es el ÚNICO que soporta', () => {
    const { nav } = navegadorFalso({ formatos: ['audio/mp4'] });
    expect(mejorFormato(nav)).toBe('audio/mp4');
  });

  it('Firefox cae a ogg/opus', () => {
    const { nav } = navegadorFalso({ formatos: ['audio/ogg;codecs=opus'] });
    expect(mejorFormato(nav)).toBe('audio/ogg;codecs=opus');
  });

  it('un Safari viejo sin `isTypeSupported` graba SIN pedir formato', () => {
    // Pedirle uno que no soporta lanza; no pedir ninguno siempre funciona.
    const { nav } = navegadorFalso({ formatos: null });
    expect(mejorFormato(nav)).toBeUndefined();
  });

  it('un navegador que no soporta nada tampoco revienta', () => {
    const { nav } = navegadorFalso({ formatos: [] });
    expect(mejorFormato(nav)).toBeUndefined();
  });

  it('la grabadora se crea con el formato elegido', async () => {
    const { nav, grabadoras } = navegadorFalso({ formatos: ['audio/mp4'] });
    const voz = crearVoz({ navegador: nav });
    await voz.grabar();
    expect(grabadoras[0]?.mimeType).toBe('audio/mp4');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2 · Narrar, y sobre todo callar
// ═══════════════════════════════════════════════════════════════════════════

describe('narrar', () => {
  it('reproduce la URL del endpoint — el navegador hace el streaming', async () => {
    // Es la única forma de arranque progresivo que funciona en iPhone: no hay
    // MediaSource Extensions en Safari de iOS.
    const { nav, audio } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    const sonando = voz.narrar('¿Cómo se llama tu negocio?');
    expect(audio.src).toContain('/voz/api/narrar');
    expect(audio.src).toContain('texto=');
    expect(audio.src).toContain('voz=ana');

    audio.emitir('ended');
    await sonando;
  });

  it('escapa el texto en la URL', async () => {
    // Un `&` sin escapar partiría el parámetro en dos y el servidor recibiría
    // media pregunta. Un `¿` sin escapar rompe la URL en algunos proxies.
    const { nav, audio } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    const sonando = voz.narrar('¿Qué tal? & más');
    expect(audio.src).not.toContain('& más');
    expect(audio.src).toContain('%26');

    const url = new URL(audio.src, 'https://mi.abraxa.club');
    expect(url.searchParams.get('texto')).toBe('¿Qué tal? & más');

    audio.emitir('ended');
    await sonando;
  });

  it('`narrando()` dice si hay algo sonando', async () => {
    const { nav, audio } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });
    expect(voz.narrando()).toBe(false);

    const sonando = voz.narrar('hola');
    expect(voz.narrando()).toBe(true);

    audio.emitir('ended');
    await sonando;
    expect(voz.narrando()).toBe(false);
  });

  it('CALLAR abandona la descarga, no sólo el sonido', async () => {
    // Sin soltar el `src`, iOS se sigue bajando el audio entero aunque nadie lo
    // oiga: gasta datos del invitado y deja el reproductor ocupado.
    const { nav, audio } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    const sonando = voz.narrar('una frase larga');
    voz.callar();
    await sonando; // callar NO es un error: es lo que pidió el invitado

    expect(audio.pausas).toBeGreaterThan(0);
    expect(audio.quitados).toContain('src');
    expect(audio.cargas).toBeGreaterThan(0);
    expect(voz.narrando()).toBe(false);
  });

  it('una narración nueva calla la anterior', async () => {
    const { nav, audio } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    const primera = voz.narrar('primera');
    const segunda = voz.narrar('segunda');
    await primera; // la primera se resolvió al ser cortada

    expect(audio.src).toContain(encodeURIComponent('segunda'));
    audio.emitir('ended');
    await segunda;
  });

  it('un AbortSignal también la corta', async () => {
    const { nav } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });
    const control = new AbortController();

    const sonando = voz.narrar('hola', { signal: control.signal });
    control.abort();
    await sonando;
    expect(voz.narrando()).toBe(false);
  });

  it('si el `<audio>` falla, se le PREGUNTA al servidor por qué', async () => {
    // El elemento sólo dispara `error`, sin decir nada. El servidor sí lo sabe
    // y lo dice tipado, que es lo que permite degradar a texto a conciencia.
    const sinPagar = {
      error: {
        code: 'BUDGET_EXCEEDED',
        message: 'La cuenta de ElevenLabs no tiene la suscripción al corriente.',
        voz: { reintentable: false, definitivo: true, proveedor: 'elevenlabs' },
      },
    };
    const { nav, audio } = navegadorFalso({
      respuesta: async () => new Response(JSON.stringify(sinPagar), { status: 402 }),
    });
    const voz = crearVoz({ navegador: nav });

    const sonando = voz.narrar('hola');
    audio.emitir('error');

    await expect(sonando).rejects.toMatchObject({
      name: 'FalloDeVoz',
      code: 'BUDGET_EXCEEDED',
      definitivo: true,
    });
  });

  it('si iOS bloquea el autoplay, el mensaje dice qué hacer', async () => {
    const { nav, audio } = navegadorFalso();
    audio.alReproducir = async () => {
      throw Object.assign(new Error('gesture required'), { name: 'NotAllowedError' });
    };
    const voz = crearVoz({ navegador: nav });

    await expect(voz.narrar('hola')).rejects.toThrow(/desbloquear/);
  });

  it('`desbloquear()` reproduce un silencio y no lanza nunca', async () => {
    const { nav, audio } = navegadorFalso();
    audio.alReproducir = async () => {
      throw new Error('bloqueado');
    };
    const voz = crearVoz({ navegador: nav });

    await expect(voz.desbloquear()).resolves.toBeUndefined();
    expect(audio.reproducciones[0]).toBe(SILENCIO);
  });

  it('el silencio es un WAV válido de 44 bytes', () => {
    const base64 = SILENCIO.split(',')[1] ?? '';
    const bytes = Buffer.from(base64, 'base64');
    expect(bytes).toHaveLength(44);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
  });

  it('un texto larguísimo no cabe en la URL y se baja por POST', async () => {
    const { nav, audio, peticiones } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    const sonando = voz.narrar('a'.repeat(800));
    await hasta(() => audio.src !== '');

    expect(peticiones[0]?.init?.method).toBe('POST');
    expect(audio.src).toContain('blob:falso');
    audio.emitir('ended');
    await sonando;
  });

  it('un texto por encima del tope absoluto falla ANTES de pedir nada', async () => {
    const { nav, peticiones } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });
    await expect(voz.narrar('a'.repeat(3000))).rejects.toThrow(FalloDeVoz);
    expect(peticiones).toHaveLength(0);
  });
});

describe('precargar — lo que hace que la pregunta suene en el milisegundo cero', () => {
  it('baja el audio y la siguiente narración no pide nada', async () => {
    const { nav, audio, peticiones } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    await voz.precargar('la siguiente pregunta');
    expect(peticiones).toHaveLength(1);

    const sonando = voz.narrar('la siguiente pregunta');
    expect(audio.src).toContain('blob:falso'); // ya estaba en el navegador
    expect(peticiones).toHaveLength(1); // y no se pidió nada más

    audio.emitir('ended');
    await sonando;
  });

  it('precargar dos veces lo mismo no vuelve a bajarlo', async () => {
    const { nav, peticiones } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });
    await voz.precargar('x');
    await voz.precargar('x');
    expect(peticiones).toHaveLength(1);
  });

  it('la precarga tiene tope: no crece sin límite', async () => {
    const { nav, peticiones } = navegadorFalso();
    const voz = crearVoz({ navegador: nav, topeDePrecarga: 2 });

    await voz.precargar('uno');
    await voz.precargar('dos');
    await voz.precargar('tres'); // desaloja «uno»

    await voz.precargar('uno'); // hay que volver a bajarlo
    expect(peticiones).toHaveLength(4);
  });

  it('libera la URL del objeto al terminar — si no, es una fuga', async () => {
    const { nav, audio, urlsVivas } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });
    await voz.precargar('x');

    const sonando = voz.narrar('x');
    expect(urlsVivas()).toBe(1);
    audio.emitir('ended');
    await sonando;
    expect(urlsVivas()).toBe(0);
  });

  it('un error del servidor sale tipado desde `precargar`', async () => {
    const { nav } = navegadorFalso({
      respuesta: async () =>
        new Response(
          JSON.stringify({
            error: { code: 'PORT_NOT_IMPLEMENTED', message: 'falta ELEVENLABS_API_KEY' },
          }),
          { status: 501 },
        ),
    });
    const voz = crearVoz({ navegador: nav });
    await expect(voz.precargar('x')).rejects.toMatchObject({ code: 'PORT_NOT_IMPLEMENTED' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3 y 4 · El micrófono
// ═══════════════════════════════════════════════════════════════════════════

describe('el permiso de micrófono', () => {
  const conError = (nombre: string): Guion => ({
    microfono: async () => {
      throw Object.assign(new Error(nombre), { name: nombre });
    },
  });

  it('DENEGADO: motivo tipado y un mensaje que no culpa a nadie', async () => {
    const { nav } = navegadorFalso(conError('NotAllowedError'));
    const voz = crearVoz({ navegador: nav });

    try {
      await voz.grabar();
      expect.unreachable('tenía que fallar');
    } catch (e) {
      expect(SinMicrofono.es(e)).toBe(true);
      const f = e as SinMicrofono;
      expect(f.motivo).toBe('denegado');
      // Sin micrófono, el teclado sigue ahí y nada parece roto.
      expect(f.message).toContain('escribe');
      expect(f.message).toContain('candado');
    }
  });

  it('SIN MICRÓFONO conectado', async () => {
    const { nav } = navegadorFalso(conError('NotFoundError'));
    const voz = crearVoz({ navegador: nav });
    await expect(voz.grabar()).rejects.toMatchObject({ motivo: 'sin-microfono' });
  });

  it('MICRÓFONO OCUPADO por otra app', async () => {
    const { nav } = navegadorFalso(conError('NotReadableError'));
    const voz = crearVoz({ navegador: nav });
    await expect(voz.grabar()).rejects.toMatchObject({ motivo: 'ocupado' });
  });

  it('SIN HTTPS ni se pide el permiso — el navegador no lo daría', async () => {
    // La trampa clásica de probar en http://192.168.x.x: `getUserMedia` no
    // existe fuera de contexto seguro y el síntoma es «el micrófono está mudo».
    const pedir = vi.fn();
    const { nav } = navegadorFalso({ seguro: false, microfono: pedir });
    const voz = crearVoz({ navegador: nav });

    await expect(voz.grabar()).rejects.toMatchObject({ motivo: 'sin-https' });
    expect(pedir).not.toHaveBeenCalled();
  });

  it('todos los mensajes recuerdan que se puede escribir', async () => {
    for (const nombre of ['NotAllowedError', 'NotFoundError', 'SecurityError', 'Cualquiera']) {
      const { nav } = navegadorFalso(conError(nombre));
      const voz = crearVoz({ navegador: nav });
      try {
        await voz.grabar();
      } catch (e) {
        expect((e as Error).message.toLowerCase()).toContain('escrib');
      }
    }
  });

  it('pide cancelación de eco: si no, el micrófono graba a la propia agente', async () => {
    const pedir = vi.fn(async () => ({ getTracks: () => [] }));
    const { nav } = navegadorFalso({ microfono: pedir });
    const voz = crearVoz({ navegador: nav });
    await voz.grabar();

    expect(pedir).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  });
});

describe('grabar y transcribir', () => {
  const RESPUESTA = {
    texto: 'Organizo eventos de networking.',
    proveedor: 'groq',
    modelo: 'whisper-large-v3',
    ms: 376,
    bytes: 2048,
    formato: 'audio/webm',
  };

  it('sube el audio y devuelve el texto', async () => {
    const { nav, grabadoras, peticiones } = navegadorFalso({
      respuesta: async () => new Response(JSON.stringify(RESPUESTA)),
    });
    const voz = crearVoz({ navegador: nav });

    const grabacion = await voz.grabar();
    grabadoras[0]?.emitirDatos(2048);
    const salida = await grabacion.detener();

    expect(salida.texto).toBe('Organizo eventos de networking.');
    expect(peticiones[0]?.url).toContain('/voz/api/transcribir');
    expect(peticiones[0]?.init?.method).toBe('POST');
    expect(peticiones[0]?.init?.body).toBeInstanceOf(FormData);
    expect((peticiones[0]?.init?.body as FormData).get('audio')).toBeInstanceOf(Blob);
  });

  it('EL MICRÓFONO SE SUELTA al terminar — si no, el iPhone deja el punto naranja', async () => {
    const { nav, grabadoras, pistasVivas } = navegadorFalso({
      respuesta: async () => new Response(JSON.stringify(RESPUESTA)),
    });
    const voz = crearVoz({ navegador: nav });

    const grabacion = await voz.grabar();
    expect(pistasVivas()).toBe(1);

    grabadoras[0]?.emitirDatos(2048);
    await grabacion.detener();
    expect(pistasVivas()).toBe(0);
  });

  it('el micrófono se suelta TAMBIÉN cuando la transcripción falla', async () => {
    const { nav, grabadoras, pistasVivas } = navegadorFalso({
      respuesta: async () => new Response('{"error":{"code":"RATE_LIMITED"}}', { status: 429 }),
    });
    const voz = crearVoz({ navegador: nav });

    const grabacion = await voz.grabar();
    grabadoras[0]?.emitirDatos(2048);
    await expect(grabacion.detener()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(pistasVivas()).toBe(0);
  });

  it('CANCELAR no sube nada y suelta el micrófono', async () => {
    const { nav, grabadoras, pistasVivas, peticiones } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    const grabacion = await voz.grabar();
    grabadoras[0]?.emitirDatos(2048);
    grabacion.cancelar();

    expect(peticiones).toHaveLength(0);
    expect(pistasVivas()).toBe(0);
    expect(grabacion.activa()).toBe(false);
  });

  it('una grabación vacía se dice, y no se sube', async () => {
    const { nav, peticiones } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    const grabacion = await voz.grabar();
    await expect(grabacion.detener()).rejects.toThrow(FalloDeVoz);
    expect(peticiones).toHaveLength(0);
  });

  it('grabar CALLA la voz — es el barge-in', async () => {
    // Si el invitado empieza a hablar, la agente se calla. Y de paso el
    // micrófono no se graba a sí misma.
    const { nav, audio } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    const sonando = voz.narrar('una pregunta larga');
    expect(voz.narrando()).toBe(true);

    await voz.grabar();
    await sonando;

    expect(voz.narrando()).toBe(false);
    expect(audio.quitados).toContain('src');
  });

  it('graba en trozos de un segundo, no en uno solo al final', async () => {
    const { nav, grabadoras } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });
    await voz.grabar();
    expect(grabadoras[0]?.intervalos).toEqual([1000]);
  });

  it('corta sola al llegar al tope de bytes', async () => {
    const { nav, grabadoras } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    await voz.grabar();
    grabadoras[0]?.emitirDatos(16 * 1024 * 1024); // más de 15 MB
    expect(grabadoras[0]?.state).toBe('inactive');
  });

  it('corta sola por tiempo y avisa', async () => {
    vi.useFakeTimers();
    try {
      const { nav, grabadoras } = navegadorFalso();
      const voz = crearVoz({ navegador: nav });
      const aviso = vi.fn();

      await voz.grabar({ topeMs: 1000, alCortarPorTiempo: aviso });
      vi.advanceTimersByTime(1001);

      expect(aviso).toHaveBeenCalledOnce();
      expect(grabadoras[0]?.state).toBe('inactive');
    } finally {
      vi.useRealTimers();
    }
  });

  it('detener dos veces no vuelve a subir', async () => {
    const { nav, grabadoras, peticiones } = navegadorFalso({
      respuesta: async () => new Response(JSON.stringify(RESPUESTA)),
    });
    const voz = crearVoz({ navegador: nav });

    const grabacion = await voz.grabar();
    grabadoras[0]?.emitirDatos(2048);
    await grabacion.detener();
    await expect(grabacion.detener()).rejects.toThrow(FalloDeVoz);
    expect(peticiones).toHaveLength(1);
  });

  it('manda el idioma y el contexto si se los dan', async () => {
    const { nav, grabadoras, peticiones } = navegadorFalso({
      respuesta: async () => new Response(JSON.stringify(RESPUESTA)),
    });
    const voz = crearVoz({ navegador: nav });

    const grabacion = await voz.grabar({ idioma: 'es', contexto: 'Cariñeeto, Inperio' });
    grabadoras[0]?.emitirDatos(2048);
    await grabacion.detener();

    const formulario = peticiones[0]?.init?.body as FormData;
    expect(formulario.get('idioma')).toBe('es');
    expect(formulario.get('contexto')).toBe('Cariñeeto, Inperio');
  });

  it('`destruir()` calla, suelta el micrófono y limpia', async () => {
    const { nav, pistasVivas } = navegadorFalso();
    const voz = crearVoz({ navegador: nav });

    void voz.narrar('hola');
    await voz.grabar();
    voz.destruir();

    expect(voz.narrando()).toBe(false);
    expect(pistasVivas()).toBe(0);
  });
});
