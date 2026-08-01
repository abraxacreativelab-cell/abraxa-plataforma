/**
 * Lo que decide si leer una página ayuda o estorba:
 *
 *  · la SPA vacía, que es la mitad de las páginas de negocio mexicanas hoy
 *    (Framer, Wix, Squarespace) y que devuelve 200 con cero texto;
 *  · la redirección a la red de adentro, que es la evasión clásica de SSRF y
 *    la única que no se ve mirando la URL original;
 *  · y que un tropiezo NUNCA sea un error en pantalla.
 */
import { describe, expect, it } from 'vitest';
import { decodificar, hayTextoUtil, paraElModelo, textoDe, tituloDe } from './leer';
import { jsonDeLaRespuesta, propuestasDe } from './extraer';

const PAGINA = `
<!doctype html><html lang="es"><head>
  <title>La Taquería del Barrio — Tacos de canasta en la Roma</title>
  <meta name="description" content="Tacos de canasta desde 1998. Pedidos para oficinas.">
  <meta property="og:site_name" content="La Taquería del Barrio">
  <script>window.__DATA__ = {precio: 25}</script>
  <style>.x{color:red}</style>
</head><body>
  <h1>Tacos de canasta hechos como en casa</h1>
  <p>Surtimos pedidos para oficinas de la Roma y la Condesa. M&iacute;nimo 20 tacos.</p>
  <p>Ord&eacute;nalos por WhatsApp al 55 1234 5678 &mdash; te los entregamos calientitos.</p>
  <ul><li>Canasta $18</li><li>Guisado $25</li></ul>
</body></html>`;

const SPA = `
<!doctype html><html><head><title>Mi negocio</title></head>
<body><div id="__framer"></div><script src="/bundle.js"></script></body></html>`;

describe('sacar el texto de una página', () => {
  it('toma el título', () => {
    expect(tituloDe(PAGINA)).toBe('La Taquería del Barrio — Tacos de canasta en la Roma');
    expect(tituloDe('<html><body>sin título</body></html>')).toBeNull();
  });

  it('tira scripts y estilos: su contenido no es texto de la página', () => {
    const t = textoDe(PAGINA);
    expect(t).not.toContain('window.__DATA__');
    expect(t).not.toContain('color:red');
  });

  it('decodifica las entidades que de verdad salen en español', () => {
    expect(decodificar('M&iacute;nimo &mdash; Ord&eacute;nalos &amp; &ntilde;')).toBe(
      'Mínimo — Ordénalos & ñ',
    );
    expect(decodificar('&#191;qu&#233; tal&#63;')).toBe('¿qué tal?');
  });

  it('el título y la descripción viajan al frente, para que sobrevivan al recorte', () => {
    const { titulo, texto } = paraElModelo(PAGINA, 'https://lataqueria.mx/');
    expect(titulo).toContain('La Taquería del Barrio');
    expect(texto.indexOf('Tacos de canasta desde 1998')).toBeLessThan(texto.indexOf('Canasta $18'));
    expect(texto).toContain('URL: https://lataqueria.mx/');
  });

  it('respeta el tope y no devuelve media palabra de más', () => {
    const enorme = `<p>${'taco '.repeat(9000)}</p>`;
    expect(textoDe(enorme, 500).length).toBeLessThanOrEqual(500);
  });
});

describe('la SPA vacía tiene camino digno', () => {
  it('una página con contenido sí sirve', () => {
    expect(hayTextoUtil(paraElModelo(PAGINA, 'https://lataqueria.mx/').texto)).toBe(true);
  });

  it('una SPA no sirve, y eso NO es un error', () => {
    // Framer devuelve 200 con HTML válido y cero contenido. Si esto dijera que
    // sí sirve, el modelo recibiría un `<div>` vacío y le presentaría al dueño
    // datos inventados con cara de datos suyos.
    expect(hayTextoUtil(paraElModelo(SPA, 'https://mi-negocio.framer.website/').texto)).toBe(false);
  });

  it('un menú de navegación tampoco es contenido', () => {
    const solomenu = '<nav><a>Inicio</a><a>Nosotros</a><a>Contacto</a></nav>';
    expect(hayTextoUtil(paraElModelo(solomenu, 'https://x.mx/').texto)).toBe(false);
  });
});

describe('lo que devuelve el modelo', () => {
  it('saca el JSON aunque venga envuelto en markdown y con preámbulo', () => {
    const respuesta = 'Claro, aquí está:\n```json\n{"giro":"tacos de canasta"}\n```\nEspero sirva.';
    expect(jsonDeLaRespuesta(respuesta)).toEqual({ giro: 'tacos de canasta' });
  });

  it('aguanta llaves dentro de las cadenas', () => {
    expect(jsonDeLaRespuesta('{"giro":"vendo {tacos} y más","ticket":"$25"}')).toEqual({
      giro: 'vendo {tacos} y más',
      ticket: '$25',
    });
  });

  it('sin JSON devuelve null en vez de reventar', () => {
    expect(jsonDeLaRespuesta('No pude leer nada de esa página.')).toBeNull();
    expect(jsonDeLaRespuesta('{roto')).toBeNull();
  });

  it('las evasivas del modelo NO se le presentan al dueño como datos suyos', () => {
    const p = propuestasDe({
      giro: 'tacos de canasta para oficinas',
      nicho: 'No se especifica',
      ticket: 'N/A',
      modelo_ingreso: '   ',
      margen: 'esta clave no se pidió',
      canales: ['WhatsApp', 'Instagram'],
    });

    expect(p.map((x) => x.clave)).toEqual(['giro', 'canales']);
    expect(p[1]?.valor).toBe('WhatsApp, Instagram');
    // Una clave que no está en el guion no llega a la pantalla aunque el modelo
    // se la invente: no habría cómo confirmarla ni qué fase cerraría.
    expect(p.some((x) => x.clave === 'margen')).toBe(false);
  });

  it('las propuestas salen en el orden en que se iban a preguntar', () => {
    const p = propuestasDe({ canales: 'WhatsApp', categoria: 'taquería', giro: 'tacos' });
    expect(p.map((x) => x.clave)).toEqual(['categoria', 'giro', 'canales']);
  });
});
