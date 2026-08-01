/**
 * La lista blanca de proveedores.
 *
 * Lo que se prueba aquí no es una preferencia técnica: es en qué países puede
 * terminar la conversación de un cliente. El default tiene que ser Anthropic y
 * nada más, y abrirlo tiene que costar una decisión explícita — porque cada
 * proveedor abierto hay que enumerarlo en la declaración de tratamiento de
 * datos, y un país de más ahí puede costar el rechazo de la integración.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  invalidarCacheReglas,
  modeloPermitido,
  parsearReglas,
  PERMITIDOS_POR_DEFECTO,
  razonDeBloqueo,
  reglasVigentes,
  VAR_ENTORNO,
} from './allowlist';

afterEach(() => {
  delete process.env[VAR_ENTORNO];
  invalidarCacheReglas();
});

describe('el default: sólo Anthropic', () => {
  it('deja pasar a Anthropic, directo y por OpenRouter', () => {
    expect(modeloPermitido('claude-haiku-4-5', 'anthropic')).toBe(true);
    expect(modeloPermitido('claude-sonnet-5', 'anthropic')).toBe(true);
    // Un modelo que el catálogo todavía no tabula también: la lista es de
    // PROVEEDORES, no de modelos, y estrenar un Claude no debe pedir un deploy.
    expect(modeloPermitido('claude-opus-6', 'anthropic')).toBe(true);
    expect(modeloPermitido('anthropic/claude-haiku-4.5', 'openrouter')).toBe(true);
    expect(modeloPermitido('anthropic/claude-opus-6', 'openrouter')).toBe(true);
  });

  it('BLOQUEA a los dos que aparecieron en el ledger sin que nadie los configurara', () => {
    // DeepSeek procesa en China. Mientras exista un camino de código que pueda
    // mandarle una conversación, China tendría que ir en la declaración.
    expect(modeloPermitido('deepseek/deepseek-chat', 'openrouter')).toBe(false);
    expect(modeloPermitido('google/gemini-2.5-flash', 'openrouter')).toBe(false);
  });

  it('bloquea cualquier otro vendor de OpenRouter, no sólo los dos conocidos', () => {
    // La lista es por permiso, no por prohibición: lo que no está, no pasa. Un
    // vendor nuevo en OpenRouter no requiere que nadie se acuerde de vetarlo.
    for (const m of ['meta-llama/llama-3-70b', 'mistralai/mistral-large', 'x-ai/grok-2']) {
      expect(modeloPermitido(m, 'openrouter'), m).toBe(false);
    }
  });

  it("'local' pasa: es infraestructura propia y no agrega ningún país", () => {
    expect(modeloPermitido('llama-propio', 'local')).toBe(true);
  });

  it('un id vacío no pasa por ninguna puerta', () => {
    expect(modeloPermitido('', 'anthropic')).toBe(false);
    expect(modeloPermitido('   ', 'anthropic')).toBe(false);
  });

  it('el default declarado es el que de verdad se aplica', () => {
    // Si alguien edita la constante y se olvida del parser, esto lo caza.
    expect(reglasVigentes()).toEqual(parsearReglas(PERMITIDOS_POR_DEFECTO));
  });
});

describe('configurable, pero explícito', () => {
  it('la variable de entorno REEMPLAZA la lista, no la suma', () => {
    process.env[VAR_ENTORNO] = 'openrouter:google/*';
    invalidarCacheReglas();

    expect(modeloPermitido('google/gemini-2.5-flash', 'openrouter')).toBe(true);
    // Y Anthropic queda fuera, porque la lista es exactamente lo que dice.
    // Reemplazar en vez de sumar es lo que hace que la variable se pueda leer
    // de un vistazo en el despliegue sin cruzarla con un default.
    expect(modeloPermitido('claude-haiku-4-5', 'anthropic')).toBe(false);
  });

  it('quitar la variable vuelve a cerrar la puerta, sin tocar código', () => {
    process.env[VAR_ENTORNO] = 'anthropic:*,openrouter:deepseek/*';
    invalidarCacheReglas();
    expect(modeloPermitido('deepseek/deepseek-chat', 'openrouter')).toBe(true);

    delete process.env[VAR_ENTORNO];
    invalidarCacheReglas();
    expect(modeloPermitido('deepseek/deepseek-chat', 'openrouter')).toBe(false);
  });

  it('una entrada mal escrita NO abre nada: falla hacia cerrado', () => {
    // Un typo en una variable de entorno no puede terminar autorizando a un
    // proveedor. Lo contrario —interpretarla "de buena fe"— es exactamente cómo
    // se cuela un país a la declaración.
    for (const malo of ['openrouter', 'proveedor-inventado:*', 'openrouter:', ':*', '']) {
      expect(parsearReglas(malo), malo).toEqual([]);
    }
  });

  it('una entrada mala en medio no arrastra a las buenas', () => {
    process.env[VAR_ENTORNO] = 'anthropic:*,basura,openrouter:anthropic/*';
    invalidarCacheReglas();

    expect(modeloPermitido('claude-haiku-4-5', 'anthropic')).toBe(true);
    expect(modeloPermitido('anthropic/claude-haiku-4.5', 'openrouter')).toBe(true);
    expect(modeloPermitido('deepseek/deepseek-chat', 'openrouter')).toBe(false);
  });

  it('el patrón sólo admite `*` al final, y no es un comodín a medias', () => {
    process.env[VAR_ENTORNO] = 'openrouter:anthropic/claude-haiku-4.5';
    invalidarCacheReglas();

    expect(modeloPermitido('anthropic/claude-haiku-4.5', 'openrouter')).toBe(true);
    expect(modeloPermitido('anthropic/claude-sonnet-5', 'openrouter')).toBe(false);
  });
});

describe('el mensaje del rechazo', () => {
  it('dice el par, la lista vigente y CÓMO abrirla', () => {
    const r = razonDeBloqueo('deepseek/deepseek-chat', 'openrouter');

    expect(r).toContain('deepseek/deepseek-chat');
    expect(r).toContain('openrouter');
    // La lista vigente, para no tener que ir a leer código.
    expect(r).toContain('anthropic:*');
    // Y el nombre exacto de la variable, que es donde se resuelve.
    expect(r).toContain(VAR_ENTORNO);
    // Y por qué existe: sin esta frase, el siguiente la abre sin saber que hay
    // una declaración legal del otro lado.
    expect(r).toMatch(/declaraci/i);
  });
});
