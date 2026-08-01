/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Un agente tiene que nacer con una llave que EXISTA y un precio que EXISTA.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  EL DEFECTO QUE ESTAS PRUEBAS FIJAN, medido en producción el 2026-08-01:
 *
 *  Los cinco agentes semilla estaban clavados en `provider: 'anthropic'`, y no
 *  existe `ANTHROPIC_API_KEY` — a propósito: todo el tráfico del sistema sale
 *  por OpenRouter (decisión de Santiago, 2026-08-01). Consecuencia: el PRIMER
 *  turno del Ritual de Fundación de TODO tenant nuevo moría con
 *
 *      502 PROVIDER_ERROR — "No hay llave para 'anthropic'"
 *
 *  y con él los pasos 3, 4 y 5 del camino del invitado: sin conversación no hay
 *  Mapa de Negocio, sin Mapa no hay documento madre, y sin documento no hay
 *  valores que enseñar en la Bóveda. Un solo campo mal, y el producto entero.
 *
 *  Lo que NO se prueba aquí, a propósito: qué llave hay puesta en el entorno.
 *  La semilla no mira el entorno — nace en OpenRouter siempre. Que la llave de
 *  OpenRouter esté o no es un problema de despliegue, no de la semilla, y
 *  hacerla depender del entorno significaría que dos servidores con distinto
 *  `.env` crean agentes distintos: la clase de comportamiento que sólo se
 *  descubre en producción.
 *
 *  Corren sin base y sin red.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_BY_ROLE } from '@abraxa/config';
import { dialectoValido } from '../capabilities';
import { semillasPorDefecto } from './defaults';

/**
 * Los pares que TIENEN precio sembrado en `app.model_pricing`.
 *
 * Verificado contra la base de producción el 2026-08-01. Va aquí como constante
 * y no como consulta porque estas pruebas corren sin base — y porque el punto es
 * justo que la lista sea explícita: si alguien estrena un modelo, esta prueba lo
 * obliga a sembrar su precio ANTES, en vez de descubrir el hueco cuando el
 * cliente no pueda conciliar su factura.
 */
const CON_PRECIO_EN_OPENROUTER = new Set([
  'anthropic/claude-sonnet-5', // $3 / $15 por Mtok
  'anthropic/claude-haiku-4.5', // $1 / $5  por Mtok
]);

describe('las semillas nacen en un proveedor con llave', () => {
  const semillas = semillasPorDefecto();

  it('son los cinco roles, ni uno menos', () => {
    expect(semillas.map((s) => s.role).sort()).toEqual(
      ['analyst', 'master', 'sales', 'service', 'social'].sort(),
    );
  });

  it('NINGUNA nace en anthropic — no hay llave y el primer mensaje moriría', () => {
    // Ésta es la prueba del defecto. Con el código anterior, las cinco fallaban.
    for (const s of semillas) {
      expect(s.provider, `el rol '${s.role}' nace en '${s.provider}'`).toBe('openrouter');
    }
  });

  it('el par (provider, model) respeta el dialecto del proveedor', () => {
    // Cambiar sólo `provider` y dejar el id sin prefijo da 'not a valid model ID'
    // a media corrida. Es el mismo invariante que la migración 027 impone en la
    // base con agent_definitions_provider_model_ck; aquí se atrapa antes.
    for (const s of semillas) {
      expect(dialectoValido(s.model, s.provider), `${s.provider}/${s.model} (${s.role})`).toBe(true);
    }
  });

  it('todo modelo sembrado TIENE precio: un costo sin precio deja ciega la contabilidad', () => {
    for (const s of semillas) {
      expect(
        CON_PRECIO_EN_OPENROUTER.has(s.model),
        `${s.model} (${s.role}) no tiene precio en app.model_pricing`,
      ).toBe(true);
    }
  });

  it('el modelo sigue saliendo del catálogo de @abraxa/config, sólo traducido', () => {
    // Que no aparezca una segunda lista de modelos que se desincronice con
    // DEFAULT_MODEL_BY_ROLE. El sufijo cambia; la elección no.
    const porRol = Object.fromEntries(semillas.map((s) => [s.role, s.model]));
    expect(porRol.master).toContain(DEFAULT_MODEL_BY_ROLE.master.replace('claude-', ''));
    expect(porRol.sales).toContain('haiku');
    expect(porRol.analyst).toContain('sonnet');
  });

  it('el maestro toma el nombre que le pone el emprendedor', () => {
    const conNombre = semillasPorDefecto('Sofía');
    expect(conNombre.find((s) => s.role === 'master')?.name).toBe('Sofía');
    // Y los sub-agentes NO: son de cara al cliente final y llevan el suyo.
    expect(conNombre.find((s) => s.role === 'sales')?.name).toBe('Ventas');
  });

  it('todas traen system prompt con las reglas de casa', () => {
    for (const s of semillas) {
      expect(s.systemPrompt.length, s.role).toBeGreaterThan(200);
      expect(s.systemPrompt, s.role).toContain('REGLAS QUE NO SE ROMPEN');
    }
  });
});
