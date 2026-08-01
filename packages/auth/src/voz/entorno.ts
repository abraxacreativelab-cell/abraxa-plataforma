/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las llaves de la voz, leídas en UN solo lugar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Mismo patrón que `packages/auth/src/entorno.ts`, y por la misma razón: el
 *  modo de fallo de una llave ausente es MUDO. Sin `ELEVENLABS_API_KEY` el
 *  servidor arranca igual, la pantalla se pinta igual, el invitado aprieta el
 *  botón y no pasa nada — ni un error, ni un log, ni una pista.
 *
 *  Cinco variables:
 *
 *    ELEVENLABS_API_KEY      sin ella no hay narración
 *    ELEVENLABS_VOICE_ANA    la voz cálida. Es la del Ritual.
 *    ELEVENLABS_VOICE_CARI   la segunda voz, para lo que no es entrevista
 *    GROQ_API_KEY            dictado rápido (whisper-large-v3). El camino bueno.
 *    OPENAI_API_KEY          dictado de respaldo (whisper-1)
 *
 *  ── Por qué el entorno entra como argumento ────────────────────────────────
 *
 *  Igual que en `entorno.ts`: en producción nadie lo pasa y se lee
 *  `process.env`; en las pruebas se pasa un objeto literal y se pueden
 *  comprobar los diez casos —incluido «hay Groq y OpenAI a la vez»— sin
 *  escribir en `process.env`, que es global y compartido entre archivos.
 *
 *  ── Una variable en blanco cuenta como ausente ─────────────────────────────
 *
 *  `GROQ_API_KEY=` en un `.env` es lo que deja alguien a medio configurar. Si
 *  contara como presente, el dictado elegiría Groq, mandaría `Bearer ` y
 *  recibiría un 401 que se lee como «Groq está caído» en vez de «falta pegar la
 *  llave». Aquí se recorta y, si no queda nada, no existe.
 */
import { FalloDeVoz } from './errores';

/** Sólo lo que hace falta de `process.env`. Nunca `NodeJS.ProcessEnv`. */
export type Entorno = Record<string, string | undefined>;

const entornoActual = (): Entorno => process.env as Entorno;

/** El valor recortado, o `undefined` si estaba vacío o en blanco. */
function leer(env: Entorno, clave: string): string | undefined {
  const valor = (env[clave] ?? '').trim();
  return valor.length > 0 ? valor : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
//  NARRAR — ElevenLabs
// ═══════════════════════════════════════════════════════════════════════════

/** Las dos voces del producto. `ana` es la del Ritual, y es el defecto. */
export type NombreDeVoz = 'ana' | 'cari';

export const VOCES: readonly NombreDeVoz[] = ['ana', 'cari'];

/**
 * `ana` por defecto, y no es una preferencia estética.
 *
 * El Ritual es una ENTREVISTA: alguien le está contando a un desconocido cómo
 * gana dinero y dónde se le rompe el negocio. La voz que hace esa pregunta
 * tiene que sonar a alguien con quien se puede hablar. `ELEVENLABS_VOICE_ANA`
 * apunta a una voz femenina, joven, de acento latinoamericano y registro
 * conversacional; `cari` queda para lo que no es entrevista.
 */
export const VOZ_POR_DEFECTO: NombreDeVoz = 'ana';

const VARIABLE_DE_VOZ: Record<NombreDeVoz, string> = {
  ana: 'ELEVENLABS_VOICE_ANA',
  cari: 'ELEVENLABS_VOICE_CARI',
};

/**
 * El modelo de síntesis.
 *
 * `eleven_flash_v2_5` es el de menor latencia de los que hablan español
 * (verificado contra `GET /v1/models`: `eleven_v3`, `eleven_multilingual_v2`,
 * `eleven_flash_v2_5` y `eleven_turbo_v2_5` declaran `es`). En una entrevista
 * hablada el primer sonido tarda lo que tarda el modelo en arrancar, así que
 * aquí la latencia es la característica.
 *
 * Se puede cambiar con `ELEVENLABS_MODEL` sin tocar código, por si mañana sale
 * uno mejor y hay que probarlo en el VPS antes de escribirlo aquí.
 */
export const MODELO_POR_DEFECTO = 'eleven_flash_v2_5';

/**
 * `mp3_44100_128`: el formato que el `<audio>` de todos los navegadores
 * reproduce sin ayuda, incluido el Safari de iPhone.
 *
 * No es un detalle: `opus` pesa la mitad y iOS no lo toca dentro de un
 * contenedor ogg. Un formato más eficiente que la mitad de los invitados no
 * puede reproducir es un formato peor.
 */
export const FORMATO_DE_AUDIO = 'mp3_44100_128';

export interface ConfigDeNarracion {
  llave: string;
  vozId: string;
  voz: NombreDeVoz;
  modelo: string;
  formato: string;
}

/**
 * La configuración para narrar, o un `FalloDeVoz` que explica qué falta.
 *
 * Lanza `PORT_NOT_IMPLEMENTED` y no `INTERNAL` a propósito: «este despliegue no
 * tiene narración cableada» es una verdad sobre la CONFIGURACIÓN, no un error
 * de ejecución, y el cliente la usa para apagar la voz de una vez en vez de
 * reintentar cada pregunta.
 */
export function configDeNarracion(
  voz: NombreDeVoz = VOZ_POR_DEFECTO,
  env: Entorno = entornoActual(),
): ConfigDeNarracion {
  const llave = leer(env, 'ELEVENLABS_API_KEY');
  if (!llave) {
    throw new FalloDeVoz(
      'PORT_NOT_IMPLEMENTED',
      'Este servidor no tiene voz: falta ELEVENLABS_API_KEY. Sigue escribiendo, que se ' +
        'entiende igual.',
      { proveedor: 'elevenlabs' },
    );
  }

  const variable = VARIABLE_DE_VOZ[voz];
  const vozId = leer(env, variable);
  if (!vozId) {
    throw new FalloDeVoz(
      'PORT_NOT_IMPLEMENTED',
      `Este servidor no tiene la voz «${voz}»: falta ${variable}.`,
      { proveedor: 'elevenlabs' },
    );
  }

  return {
    llave,
    vozId,
    voz,
    modelo: leer(env, 'ELEVENLABS_MODEL') ?? MODELO_POR_DEFECTO,
    formato: leer(env, 'ELEVENLABS_FORMATO') ?? FORMATO_DE_AUDIO,
  };
}

/** ¿Sabe hablar este despliegue? Sin lanzar y sin llamar a nadie. */
export function hayNarracion(
  voz: NombreDeVoz = VOZ_POR_DEFECTO,
  env: Entorno = entornoActual(),
): boolean {
  return Boolean(leer(env, 'ELEVENLABS_API_KEY') && leer(env, VARIABLE_DE_VOZ[voz]));
}

/** Normaliza lo que venga del navegador. Cualquier cosa rara cae en la de siempre. */
export function vozValida(valor: unknown): NombreDeVoz {
  return typeof valor === 'string' && (VOCES as readonly string[]).includes(valor)
    ? (valor as NombreDeVoz)
    : VOZ_POR_DEFECTO;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DICTAR — Groq primero, OpenAI de respaldo
// ═══════════════════════════════════════════════════════════════════════════

export type ProveedorDeDictado = 'groq' | 'openai';

export interface ConfigDeDictado {
  proveedor: ProveedorDeDictado;
  llave: string;
  url: string;
  modelo: string;
}

/**
 * Groq va primero, y no por gusto.
 *
 * Medido el 2026-08-01 con el mismo audio en español contra los dos
 * proveedores: Groq `whisper-large-v3` contestó en 376 ms (m4a de Safari) y
 * 447 ms (webm/opus de Chrome). OpenAI `whisper-1` contestó 429
 * `credit_balance_exhausted` — la misma llave sin cuota que ya nos mordió una
 * vez en este ecosistema.
 *
 * En una entrevista hablada medio segundo se SIENTE: es la diferencia entre
 * «me está escuchando» y «se colgó». Por eso el orden es Groq, luego OpenAI, y
 * por eso el código funciona con o sin la llave de Groq: el día que se acabe su
 * cuota, el dictado sigue existiendo, más lento.
 */
export const PROVEEDORES: Record<
  ProveedorDeDictado,
  { variable: string; url: string; modelo: string }
> = {
  groq: {
    variable: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    modelo: 'whisper-large-v3',
  },
  openai: {
    variable: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    modelo: 'whisper-1',
  },
};

/** El orden de preferencia. El primero con llave gana. */
export const ORDEN_DE_DICTADO: readonly ProveedorDeDictado[] = ['groq', 'openai'];

/**
 * Con qué proveedor se transcribe aquí, o un `FalloDeVoz` que nombra las dos
 * variables que faltan.
 *
 * `forzado` existe para las pruebas y para un `?proveedor=openai` de
 * diagnóstico: nunca para que el navegador elija a ciegas. Si se fuerza uno sin
 * llave, falla con su nombre en vez de caer al otro en silencio — un respaldo
 * silencioso convierte «Groq está mal configurado» en «Groq va lento».
 */
export function configDeDictado(
  env: Entorno = entornoActual(),
  forzado?: ProveedorDeDictado,
): ConfigDeDictado {
  const candidatos = forzado ? [forzado] : ORDEN_DE_DICTADO;

  for (const proveedor of candidatos) {
    const spec = PROVEEDORES[proveedor];
    const llave = leer(env, spec.variable);
    if (llave) {
      return {
        proveedor,
        llave,
        url: leer(env, `${proveedor.toUpperCase()}_STT_URL`) ?? spec.url,
        modelo: leer(env, `${proveedor.toUpperCase()}_STT_MODELO`) ?? spec.modelo,
      };
    }
  }

  throw new FalloDeVoz(
    'PORT_NOT_IMPLEMENTED',
    forzado
      ? `Este servidor no tiene ${forzado}: falta ${PROVEEDORES[forzado].variable}.`
      : 'Este servidor no puede transcribir: falta GROQ_API_KEY (rápida, la buena) o ' +
        'OPENAI_API_KEY (de respaldo). El teclado sigue funcionando.',
    forzado ? { proveedor: forzado } : undefined,
  );
}

/** ¿Sabe escuchar este despliegue? Sin lanzar y sin llamar a nadie. */
export function hayDictado(env: Entorno = entornoActual()): boolean {
  return ORDEN_DE_DICTADO.some((p) => Boolean(leer(env, PROVEEDORES[p].variable)));
}

// ═══════════════════════════════════════════════════════════════════════════
//  EL DIAGNÓSTICO
// ═══════════════════════════════════════════════════════════════════════════

export interface DiagnosticoDeVoz {
  /** `true` cuando las dos mitades —hablar y escuchar— pueden funcionar. */
  listo: boolean;
  narracion: { listo: boolean; voces: NombreDeVoz[]; modelo: string };
  dictado: { listo: boolean; proveedor: ProveedorDeDictado | null; modelo: string | null };
  /** Lo que impide que la voz funcione, en español y con el nombre de la variable. */
  faltantes: string[];
  /** Lo que va a doler pero no la impide hoy. */
  advertencias: string[];
}

/**
 * Qué falta para que la voz funcione, en español.
 *
 * Mismo contrato que `diagnosticoDeIdentidad()`: nombre de la variable y
 * CONSECUENCIA. Sirve para el arranque del servidor, para un endpoint de estado
 * y para que el cliente apague la voz antes de intentarlo — que es la única
 * forma de que el invitado no vea nunca un botón de micrófono que no hace nada.
 */
export function diagnosticoDeVoz(env: Entorno = entornoActual()): DiagnosticoDeVoz {
  const faltantes: string[] = [];
  const advertencias: string[] = [];

  const hayLlaveEleven = Boolean(leer(env, 'ELEVENLABS_API_KEY'));
  const voces = VOCES.filter((v) => Boolean(leer(env, VARIABLE_DE_VOZ[v])));

  if (!hayLlaveEleven) {
    faltantes.push(
      'ELEVENLABS_API_KEY: sin ella el producto no habla. El Ritual sigue funcionando por ' +
        'escrito, pero se pierde la mitad de lo que hace que parezca una conversación.',
    );
  }
  if (hayLlaveEleven && voces.length === 0) {
    faltantes.push(
      'ELEVENLABS_VOICE_ANA: hay llave de ElevenLabs pero ninguna voz. Con la llave sola no ' +
        'se puede sintetizar nada: el id de la voz va en la URL.',
    );
  }
  if (hayLlaveEleven && voces.length === 1 && !voces.includes(VOZ_POR_DEFECTO)) {
    advertencias.push(
      `ELEVENLABS_VOICE_ANA: falta la voz del Ritual. Sólo está «${voces[0]}», que no es la ` +
        'que se eligió para entrevistar.',
    );
  }

  const conLlave = ORDEN_DE_DICTADO.filter((p) => Boolean(leer(env, PROVEEDORES[p].variable)));
  if (conLlave.length === 0) {
    faltantes.push(
      'GROQ_API_KEY (o OPENAI_API_KEY): sin ninguna de las dos no se puede dictar. El ' +
        'micrófono del navegador NO sirve de respaldo — la API SpeechRecognition no existe ' +
        'en el Safari de iPhone, que es con lo que llega la mitad de los invitados.',
    );
  } else if (!conLlave.includes('groq')) {
    advertencias.push(
      'GROQ_API_KEY: sin ella el dictado cae a OpenAI whisper-1, que es notablemente más ' +
        'lento. En una entrevista hablada esa diferencia se siente.',
    );
  }

  const elegido = conLlave[0] ?? null;

  return {
    listo: faltantes.length === 0,
    narracion: {
      listo: hayLlaveEleven && voces.length > 0,
      voces,
      modelo: leer(env, 'ELEVENLABS_MODEL') ?? MODELO_POR_DEFECTO,
    },
    dictado: {
      listo: elegido !== null,
      proveedor: elegido,
      modelo: elegido
        ? (leer(env, `${elegido.toUpperCase()}_STT_MODELO`) ?? PROVEEDORES[elegido].modelo)
        : null,
    },
    faltantes,
    advertencias,
  };
}
