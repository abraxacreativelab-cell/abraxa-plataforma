/**
 * La normalización es el eslabón más barato de romper y el más caro de
 * descubrir roto: si dos caminos producen llaves distintas, el índice único de
 * 120 deja de servir y aparecen contactos duplicados semanas después, sin que
 * nada falle.
 */
import { describe, expect, it } from 'vitest';
import { PlatformError } from '@abraxa/db';
import {
  colaTelefonica,
  esGrupo,
  etiquetaCanal,
  normalizarCorreo,
  normalizarHandle,
  normalizarIdentidad,
  normalizarTelefono,
} from './identity';

describe('normalizarTelefono', () => {
  it('deja el mismo número desde las cuatro formas en que llega', () => {
    const esperado = '+528146811675';
    expect(normalizarTelefono('+52 81 4681 1675')).toBe(esperado);
    expect(normalizarTelefono('+52-81-4681-1675')).toBe(esperado);
    expect(normalizarTelefono('528146811675')).toBe(esperado);
    expect(normalizarTelefono('  +528146811675  ')).toBe(esperado);
  });

  it('quita el sufijo de JID de WhatsApp', () => {
    expect(normalizarTelefono('528146811675@s.whatsapp.net')).toBe('+528146811675');
    expect(normalizarTelefono('528146811675@c.us')).toBe('+528146811675');
  });

  it('quita el id de dispositivo que pega Evolution', () => {
    expect(normalizarTelefono('528146811675:12@s.whatsapp.net')).toBe('+528146811675');
  });

  /**
   * La trampa mexicana. Es el duplicado más común del mercado de este producto:
   * el mismo celular llega con y sin el `1` que México eliminó en 2019.
   */
  it('colapsa el 1 heredado de los celulares mexicanos', () => {
    expect(normalizarTelefono('5218146811675')).toBe('+528146811675');
    expect(normalizarTelefono('+5218146811675')).toBe('+528146811675');
    expect(normalizarTelefono('5218146811675@s.whatsapp.net')).toBe('+528146811675');
  });

  it('NO recorta números de otros países que empiezan con 521', () => {
    // 12 dígitos, no 13: no es el caso mexicano y tocarlo lo rompería.
    expect(normalizarTelefono('+521814681167')).toBe('+521814681167');
  });

  it('traduce el prefijo internacional 00', () => {
    expect(normalizarTelefono('00528146811675')).toBe('+528146811675');
  });

  it('NO inventa el país de un número local', () => {
    // `8146811675` puede ser mexicano o estadounidense. Adivinar sería inventar
    // un dato; `findDuplicates` lo propone después por la cola de 10 dígitos.
    expect(normalizarTelefono('814 681 1675')).toBe('8146811675');
    expect(normalizarTelefono('8146811675')).not.toContain('+');
  });
});

describe('normalizarCorreo', () => {
  it('baja a minúsculas y quita espacios', () => {
    expect(normalizarCorreo('  Hola@Abraxa.Club ')).toBe('hola@abraxa.club');
  });

  it('desenvuelve el formato con nombre', () => {
    expect(normalizarCorreo('Santiago <santiago@abraxa.club>')).toBe('santiago@abraxa.club');
  });

  it('quita el prefijo mailto:', () => {
    expect(normalizarCorreo('mailto:hola@abraxa.club')).toBe('hola@abraxa.club');
  });
});

describe('normalizarHandle', () => {
  it('quita la arroba y baja a minúsculas', () => {
    expect(normalizarHandle('@Abraxa')).toBe('abraxa');
  });

  it('extrae el usuario de una URL de perfil', () => {
    expect(normalizarHandle('https://instagram.com/abraxa/')).toBe('abraxa');
    expect(normalizarHandle('https://www.instagram.com/abraxa?hl=es')).toBe('abraxa');
  });

  it('deja intacto un PSID numérico de Meta', () => {
    expect(normalizarHandle('17841400000000000')).toBe('17841400000000000');
  });
});

describe('normalizarIdentidad', () => {
  it('conserva lo que entró en `raw` para poder depurar un choque', () => {
    const r = normalizarIdentidad('whatsapp', '5218146811675@s.whatsapp.net');
    expect(r.identifier).toBe('+528146811675');
    expect(r.raw).toBe('5218146811675@s.whatsapp.net');
    expect(r.channel).toBe('whatsapp');
  });

  it('rechaza una identidad vacía con VALIDATION, no con un 500', () => {
    expect(() => normalizarIdentidad('email', '   ')).toThrow(PlatformError);
    try {
      normalizarIdentidad('email', '');
    } catch (e) {
      expect(PlatformError.is(e) && e.code).toBe('VALIDATION');
    }
  });

  it('rechaza un teléfono que no deja un solo dígito', () => {
    expect(() => normalizarIdentidad('whatsapp', '----')).toThrow(PlatformError);
  });
});

/**
 * La guarda de grupo vive en `normalizarIdentidad`, que es el ÚNICO punto por
 * el que pasan los tres caminos (`create`, `addIdentity`, `resolveByIdentity`).
 * Estaba sólo en `resolveByIdentity`, y por los otros dos un grupo entraba al
 * CRM disfrazado de teléfono internacional: `normalizarTelefono` le recorta el
 * `@g.us` y deja `+120363041234567890`.
 */
describe('normalizarIdentidad — grupos', () => {
  it('rechaza un JID de grupo en vez de convertirlo en teléfono', () => {
    expect(() => normalizarIdentidad('whatsapp', '120363041234567890@g.us')).toThrow(
      /grupo de WhatsApp/,
    );
    expect(() => normalizarIdentidad('whatsapp', 'status@broadcast')).toThrow(/grupo de WhatsApp/);
    expect(() => normalizarIdentidad('whatsapp', '528146811675-1600000000')).toThrow(
      /grupo de WhatsApp/,
    );
  });

  it('y no se lleva por delante un número de persona', () => {
    expect(normalizarIdentidad('whatsapp', '5218146811675@s.whatsapp.net').identifier).toBe(
      '+528146811675',
    );
    expect(normalizarIdentidad('whatsapp', '+52 81 4681 1675').identifier).toBe('+528146811675');
  });
});

describe('esGrupo', () => {
  it('reconoce los grupos de WhatsApp', () => {
    expect(esGrupo('120363000000000000@g.us')).toBe(true);
    expect(esGrupo('status@broadcast')).toBe(true);
    expect(esGrupo('528146811675-1600000000')).toBe(true);
  });

  it('no confunde una persona con un grupo', () => {
    expect(esGrupo('528146811675@s.whatsapp.net')).toBe(false);
    expect(esGrupo('+528146811675')).toBe(false);
  });
});

describe('colaTelefonica', () => {
  it('empareja el número internacional con el local', () => {
    expect(colaTelefonica('+528146811675')).toBe('8146811675');
    expect(colaTelefonica('8146811675')).toBe('8146811675');
  });

  it('devuelve null si no hay suficientes dígitos para afirmar nada', () => {
    expect(colaTelefonica('12345')).toBeNull();
  });
});

describe('etiquetaCanal', () => {
  it('traduce los canales conocidos y deja pasar los que no', () => {
    expect(etiquetaCanal('whatsapp')).toBe('WhatsApp');
    expect(etiquetaCanal('email')).toBe('Correo');
    expect(etiquetaCanal('web')).toBe('Web');
  });
});
