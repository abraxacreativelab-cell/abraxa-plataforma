/**
 * ════════════════════════════════════════════════════════════════════════════
 *  De la página al guion: lo extrae el MODELO, no una heurística.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La tentación es escribir reglas: si el título trae "taquería", categoría =
 *  taquería. Funciona con doce páginas y se rompe con la trece, y sobre todo se
 *  rompe en silencio: le presenta al invitado un dato inventado con cara de
 *  dato suyo.
 *
 *  El port de agentes ya está ahí, ya sabe hablar español y ya corre con el
 *  contexto de su empresa. Se le manda el texto de la página y se le piden los
 *  campos del guion. Lo que devuelve NO entra al estado: entra a una tarjeta que
 *  dice «esto lo saqué de tu página, ¿está bien?» y espera a que él lo confirme.
 *
 *  ── Tres reglas que hacen que esto no mienta ──────────────────────────────
 *
 *   1. **Sólo lo que está escrito.** Si la página no dice cuánto cobra, el
 *      campo no viene. Un modelo servicial inventa un ticket «típico del giro»
 *      con toda naturalidad; el prompt lo prohíbe y el filtro de abajo tira lo
 *      que no venga con evidencia.
 *   2. **Nada se da por cierto.** Todo sale como propuesta editable.
 *   3. **Fallar es gratis.** Si el modelo no contesta, si contesta algo que no
 *      es JSON o si contesta vacío, el Ritual sigue por el camino normal. Leer
 *      la página es un atajo, nunca un requisito.
 */
import { usePort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { log } from '../logger';
import type { PropuestaDelSitio } from '../types';
import { ayudaDe } from '../interview/ayudas';

/**
 * Qué campos se le piden, cómo se llaman para el invitado y qué se le dice al
 * modelo que son.
 *
 * Son EXACTAMENTE las claves de `interview/cierre.ts`, y no por casualidad: lo
 * que se extrae tiene que poder contestar una pregunta del guion, o no sirve de
 * nada. Un dato que no cierra ninguna fase no le ahorra un segundo a nadie.
 */
const CAMPOS: Array<{ clave: string; etiqueta: string; pide: string }> = [
  {
    clave: 'categoria',
    etiqueta: 'De qué es el negocio',
    pide: 'la categoría gruesa del negocio, en dos o tres palabras (taquería, consultorio dental, tienda de ropa, agencia de marketing…)',
  },
  {
    clave: 'giro',
    etiqueta: 'A qué se dedica',
    pide: 'a qué se dedica exactamente, en UNA frase corta y con las palabras de la página',
  },
  {
    clave: 'nicho',
    etiqueta: 'A quién le vende',
    pide: 'a quién le vende, sólo si la página lo dice con claridad',
  },
  {
    clave: 'modelo_ingreso',
    etiqueta: 'Cómo cobra',
    pide: 'cómo cobra (por pieza, por proyecto, mensualidad, por hora), sólo si aparece',
  },
  {
    clave: 'ticket',
    etiqueta: 'Cuánto cobra',
    pide: 'precios o rangos de precio, TAL CUAL están escritos, sólo si aparecen',
  },
  {
    clave: 'canales',
    etiqueta: 'Por dónde le escriben',
    pide: 'los canales de contacto que se ven en la página (WhatsApp, Instagram, Facebook, teléfono, formulario), separados por comas',
  },
];

const CLAVES = new Set(CAMPOS.map((c) => c.clave));

const ETIQUETAS = new Map(CAMPOS.map((c) => [c.clave, c.etiqueta]));

/** Lo que se le antepone al agente para esta corrida. No es una entrevista. */
function instrucciones(): string {
  return `
--- TAREA APARTE: LEER UNA PÁGINA ---

Esto NO es la entrevista. No le hables a nadie, no saludes y no hagas preguntas. Te doy el texto
de la página web de un negocio y me devuelves lo que de ahí se pueda saber, en JSON y nada más.

Devuelve EXACTAMENTE un objeto JSON con estas claves, todas opcionales:

${CAMPOS.map((c) => `  "${c.clave}": ${c.pide}`).join('\n')}

Reglas, y son duras:
- **Sólo lo que la página dice.** Si no dice el precio, NO pongas precio. Si no dice a quién le
  vende, NO lo inventes. Un campo ausente es una respuesta correcta; un campo inventado le pone
  al dueño en la boca algo que él no dijo, y eso lo va a ver.
- Nada de rellenar con lo "típico del giro". Cero suposiciones.
- Español de México, con las palabras de la página, no con las tuyas.
- Cada valor, una línea. Sin markdown, sin viñetas, sin comillas de más.
- Si la página no deja saber nada del negocio, devuelve {}.
- Responde SÓLO el JSON. Ni una palabra antes ni después. Sin bloques de código.
`.trim();
}

/**
 * Saca el primer objeto JSON de una respuesta del modelo.
 *
 * Los modelos envuelven el JSON en ```json aunque se les pida que no, y a veces
 * anteponen "Aquí está:". Se busca el primer `{` y se recorta hasta su cierre
 * balanceado en vez de confiar en el formato — es la diferencia entre extraer
 * la mitad de las veces y extraer siempre.
 */
export function jsonDeLaRespuesta(texto: string): Record<string, unknown> | null {
  const inicio = texto.indexOf('{');
  if (inicio === -1) return null;

  let nivel = 0;
  let enCadena = false;
  let escapado = false;

  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];

    if (enCadena) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') enCadena = false;
      continue;
    }

    if (c === '"') enCadena = true;
    else if (c === '{') nivel++;
    else if (c === '}') {
      nivel--;
      if (nivel === 0) {
        try {
          const valor: unknown = JSON.parse(texto.slice(inicio, i + 1));
          return valor && typeof valor === 'object' && !Array.isArray(valor)
            ? (valor as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/** Tope por valor: una propuesta se tiene que poder leer de un vistazo y corregir. */
const TOPE_VALOR = 240;

/**
 * Convierte el JSON del modelo en propuestas, tirando todo lo que no sirva.
 *
 * Es la última frontera antes de enseñarle algo a alguien como si fuera suyo:
 * claves que no se pidieron, valores vacíos, y las evasivas con las que un
 * modelo dice "no sé" sin decirlo ("no especificado", "n/a", "desconocido").
 * Esas últimas son las peligrosas: se ven como un dato y no lo son.
 */
export function propuestasDe(crudo: Record<string, unknown>): PropuestaDelSitio[] {
  const vacias = /^(n\/?a|no (se )?(especifica|indica|menciona|dice)|desconocid|sin (dato|informaci)|null|ninguno|no aplica|-+)$/i;

  const salida: PropuestaDelSitio[] = [];

  for (const [clave, valor] of Object.entries(crudo)) {
    if (!CLAVES.has(clave)) continue;

    const texto = Array.isArray(valor)
      ? valor.filter((v) => typeof v === 'string').join(', ')
      : typeof valor === 'string'
        ? valor
        : '';

    const limpio = texto.replace(/\s+/g, ' ').trim().slice(0, TOPE_VALOR);
    if (limpio.length < 2 || vacias.test(limpio)) continue;

    salida.push({ clave, etiqueta: ETIQUETAS.get(clave) ?? clave, valor: limpio });
  }

  // En el orden del guion, no en el que se le ocurrió al modelo: el invitado lee
  // sus propuestas en el mismo orden en que se las iban a preguntar.
  const orden = CAMPOS.map((c) => c.clave);
  return salida.sort((a, b) => orden.indexOf(a.clave) - orden.indexOf(b.clave));
}

/**
 * Le pide al agente que lea la página. Nunca lanza.
 *
 * Devuelve `[]` cuando no se pudo, y `[]` es un final perfectamente digno: el
 * agente dice «no alcancé a leer tu página, mejor cuéntame tú» y la entrevista
 * sigue exactamente igual de rápida.
 */
export async function extraerDeLaPagina(
  ctx: TenantContext,
  texto: string,
): Promise<PropuestaDelSitio[]> {
  try {
    const corrida = await usePort('agents').run(ctx, {
      role: 'master',
      systemSuffix: instrucciones(),
      // Historial vacío A PROPÓSITO: esto no es un turno de la conversación y
      // meterle la entrevista de contexto sólo lo tienta a mezclar lo que ya
      // sabe con lo que dice la página. Aquí sólo se lee la página.
      history: [],
      input: `Texto de la página:\n\n${texto}`,
    });

    const crudo = jsonDeLaRespuesta(corrida.text);
    if (!crudo) {
      log.info('el modelo no devolvió JSON al leer la página; se sigue preguntando normal.');
      return [];
    }

    return propuestasDe(crudo);
  } catch (err) {
    log.info(`no se pudo extraer de la página: ${String(err)}`);
    return [];
  }
}

/**
 * La propuesta, redactada como la contestaría él.
 *
 * Cuando confirma, esto se manda al Ritual como un turno del invitado: por eso
 * lleva su forma de hablar y no la de un formulario. El agente lo recibe, lo
 * marca con sus `[DATO:…]` y las fases se cierran solas — sin un camino de
 * escritura paralelo que pudiera saltarse las condiciones de cierre.
 */
export function comoLoDiriaEl(propuestas: PropuestaDelSitio[]): string {
  if (propuestas.length === 0) return '';

  const frases = propuestas.map((p) => {
    const ayuda = ayudaDe(p.clave);
    const encabezado = ayuda ? p.etiqueta.toLowerCase() : p.clave;
    return `${encabezado}: ${p.valor}`;
  });

  return `Esto es de mi página, ya lo revisé y está bien:\n${frases.map((f) => `- ${f}`).join('\n')}`;
}
