/**
 * La extracción determinista es la pieza que hace que la ingesta funcione sin
 * modelo. Si ésta se rompe, el producto entero se apoya en que un LLM adivine
 * bien los números — que es exactamente lo que no puede pasar.
 */
import { describe, expect, it } from 'vitest';
import {
  detectarMoneda,
  etiquetaDesdeClave,
  monedaDeclarada,
  normalizarClave,
  parsePricingDoc,
} from './money';

const buscar = (doc: string, key: string) => parsePricingDoc(doc).find((c) => c.key === key);

describe('parsePricingDoc · montos', () => {
  it('saca un monto de un bullet con separador de miles', () => {
    const c = buscar('- onboarding_fee: $8,500 — se descuenta del primer pago', 'onboarding_fee');
    expect(c).toMatchObject({ kind: 'money', value: 8500, currency: 'MXN' });
    expect(c?.note).toBe('se descuenta del primer pago');
  });

  it('respeta la etiqueta en negritas y la clave entre paréntesis', () => {
    const c = buscar('- **Costo de la chapa** (costo_chapa): $2,300', 'costo_chapa');
    expect(c?.label).toBe('Costo de la chapa');
    expect(c?.value).toBe(2300);
  });

  it('lee filas de tabla markdown y salta el encabezado y el separador', () => {
    const doc = [
      '| concepto      | monto   | nota          |',
      '|---------------|---------|---------------|',
      '| costo_envio   | $180    | zona metro    |',
      '| envio_gratis  | $1,200  |               |',
    ].join('\n');
    const cifras = parsePricingDoc(doc);
    expect(cifras.map((c) => c.key)).toEqual(['costo_envio', 'envio_gratis']);
    expect(cifras[0]?.value).toBe(180);
    expect(cifras[1]?.value).toBe(1200);
  });

  it('detecta USD y no lo confunde con pesos', () => {
    expect(buscar('- licencia_anual: USD 499', 'licencia_anual')?.currency).toBe('USD');
    expect(buscar('- soporte: $499', 'soporte')?.currency).toBe('MXN');
  });

  it('conserva decimales', () => {
    expect(buscar('- comision_fija: $12.50', 'comision_fija')?.value).toBe(12.5);
  });
});

describe('parsePricingDoc · lo que NO debe registrar', () => {
  it('descarta un bullet sin cifra', () => {
    // Regla 1: si esto no se descartara, la bóveda se llenaría de basura y el
    // emprendedor tendría que rechazar treinta borradores para hallar tres.
    expect(parsePricingDoc('- contacto: Karen\n- correo: hola@ejemplo.mx')).toEqual([]);
  });

  it('no duplica una clave que aparece dos veces', () => {
    const cifras = parsePricingDoc('- precio: $100\n- precio: $200');
    expect(cifras).toHaveLength(1);
    expect(cifras[0]?.value).toBe(100);
  });
});

describe('parsePricingDoc · rangos', () => {
  it('un rango con "de X a Y" no se guarda como precio', () => {
    const c = buscar('- paquete_franquicia: de $400,000 a $600,000', 'paquete_franquicia');
    expect(c?.value).toBeNull();
    expect(c?.note).toContain('400,000');
  });

  it('un rango con guion TAMPOCO se guarda como precio', () => {
    // Éste es el bug de GARDEN que aquí se arregló: su regex cortaba el valor
    // en el primer '-', así que sólo veía "$1,500", la detección de rango no
    // se disparaba, y 1500 quedaba registrado como el precio del paquete.
    const c = buscar('- paquete: $1,500 - $2,000', 'paquete');
    expect(c?.value).toBeNull();
  });

  it('"de 1 a 3" con una sola cifra sí se guarda', () => {
    // No todo lo que trae la palabra "a" es un rango de dos cifras.
    expect(buscar('- anticipo: $500 a la firma', 'anticipo')?.value).toBe(500);
  });
});

describe('parsePricingDoc · pendientes', () => {
  it.each(['TBD', 'pendiente', 'por definir', 'por confirmar'])(
    'registra "%s" sin valor, para que aparezca en la lista de huecos',
    (marca) => {
      const c = buscar(`- renta_local: ${marca}`, 'renta_local');
      expect(c).toBeDefined();
      expect(c?.value).toBeNull();
      expect(c?.pendiente).toBe(true);
    },
  );
});

describe('parsePricingDoc · porcentajes', () => {
  it('extrae un porcentaje como percent, no como dinero', () => {
    // Si "20%" se registrara como money, el contrato diría "$20".
    const c = buscar('- comision_pct: 20% — sobre la base neta', 'comision_pct');
    expect(c).toMatchObject({ kind: 'percent', value: 20 });
  });

  it('entiende "por ciento" escrito con letra', () => {
    expect(buscar('- iva_pct: 16 por ciento', 'iva_pct')?.value).toBe(16);
  });

  it('un porcentaje con decimal se conserva', () => {
    expect(buscar('- retencion_isr_pct: 10.67%', 'retencion_isr_pct')?.value).toBe(10.67);
  });
});

describe('moneda · cómo la escribe la gente', () => {
  it.each([
    ['- licencia_anual: USD 499', 'USD'],
    ['- licencia_anual: $499 USD', 'USD'],
    ['- licencia_anual: US$499', 'USD'],
    ['- licencia_anual: 499 dólares', 'USD'],
    ['- licencia_anual: $499 dlls', 'USD'],
    ['- licencia_anual: €499', 'EUR'],
    ['- licencia_anual: 499 euros', 'EUR'],
    ['- licencia_anual: $499 MXN', 'MXN'],
    ['- licencia_anual: 499 pesos', 'MXN'],
    // Sin señal: pesos, que es donde vive el cliente.
    ['- licencia_anual: $499', 'MXN'],
  ])('%s → %s', (linea, esperado) => {
    expect(buscar(linea, 'licencia_anual')?.currency).toBe(esperado);
  });

  it('la moneda declarada del documento aplica a todos sus montos', () => {
    // El caso que de verdad rompe una cotización: el documento lo dice UNA vez,
    // arriba, y ninguna línea repite "USD".
    const doc = ['# Tabulador internacional', 'Moneda: USD', '', '- setup: $1,200', '- iguala: $800'].join('\n');
    const cifras = parsePricingDoc(doc);
    expect(cifras.map((c) => c.currency)).toEqual(['USD', 'USD']);
  });

  it('un valor con moneda propia gana sobre la del documento', () => {
    const doc = ['Moneda: USD', '- setup: $1,200', '- traslado: $900 MXN'].join('\n');
    const porClave = Object.fromEntries(parsePricingDoc(doc).map((c) => [c.key, c.currency]));
    expect(porClave.setup).toBe('USD');
    expect(porClave.traslado).toBe('MXN');
  });

  it('«Todos los precios están en dólares» también cuenta', () => {
    const doc = 'Todos los precios están en dólares.\n\n- hosting: $49';
    expect(buscar(doc, 'hosting')?.currency).toBe('USD');
  });

  it('una mención suelta NO convierte el documento entero', () => {
    // El falso positivo caro: bastaría con buscar "USD" en cualquier parte para
    // que este documento en pesos se volviera un documento en dólares.
    const doc = [
      '# Costos de operación',
      'El proveedor de hosting nos cobra en USD, pero nosotros vendemos aquí.',
      '',
      '- plan_basico: $499',
    ].join('\n');
    expect(buscar(doc, 'plan_basico')?.currency).toBe('MXN');
  });

  it('monedaDeclarada devuelve null cuando el documento no dice nada', () => {
    expect(monedaDeclarada('# Lista de precios\n- consulta: $850')).toBeNull();
  });

  it('detectarMoneda respeta el valor por defecto que se le pase', () => {
    expect(detectarMoneda('sin señal alguna', 'EUR')).toBe('EUR');
    expect(detectarMoneda('sin señal alguna')).toBe('MXN');
  });
});

describe('normalizarClave', () => {
  it.each([
    ['Costo de Chapa', 'costo_de_chapa'],
    ['Comisión', 'comision'],
    ['  Días  de  crédito ', 'dias_de_credito'],
    ['Tamaño Máximo', 'tamano_maximo'],
    ['precio (MXN)', 'precio_mxn'],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarClave(entrada)).toBe(esperado);
  });
});

describe('etiquetaDesdeClave', () => {
  it('convierte una clave en algo legible', () => {
    expect(etiquetaDesdeClave('ticket_promedio')).toBe('Ticket promedio');
  });
});

describe('un documento de precios real', () => {
  const DOC = `# Precios 2026

## Servicios
- **Consulta inicial** (consulta_inicial): $850 — incluye diagnóstico
- seguimiento: $600
- paquete_mensual: de $4,500 a $7,000 — según alcance
- comision_vendedor_pct: 8%

## Costos
| concepto        | monto  | nota            |
|-----------------|--------|-----------------|
| renta_mensual   | $18,000 | local Roma     |
| nomina_mensual  | TBD     | falta contratar |

Contacto: Laura Méndez
`;

  it('saca exactamente las cifras y nada más', () => {
    const cifras = parsePricingDoc(DOC);
    const porClave = Object.fromEntries(cifras.map((c) => [c.key, c]));

    expect(Object.keys(porClave).sort()).toEqual([
      'comision_vendedor_pct',
      'consulta_inicial',
      'nomina_mensual',
      'paquete_mensual',
      'renta_mensual',
      'seguimiento',
    ]);

    expect(porClave.consulta_inicial?.value).toBe(850);
    expect(porClave.consulta_inicial?.label).toBe('Consulta inicial');
    expect(porClave.renta_mensual?.value).toBe(18000);
    expect(porClave.comision_vendedor_pct).toMatchObject({ kind: 'percent', value: 8 });
    // El rango y el pendiente entran SIN número.
    expect(porClave.paquete_mensual?.value).toBeNull();
    expect(porClave.nomina_mensual?.value).toBeNull();
    // Y "Contacto: Laura Méndez" no es una cifra.
    expect(porClave.contacto).toBeUndefined();
  });
});
