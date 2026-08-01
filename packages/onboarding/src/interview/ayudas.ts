/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las ayudas de respuesta — botones y ejemplos, en datos.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  «Los botones son una AYUDA, no una jaula.» Esa frase es literalmente el
 *  diseño de este archivo:
 *
 *   · toda ayuda con opciones trae `abierta: true` salvo una decisión binaria,
 *     así que siempre se puede escribir lo propio;
 *   · los ejemplos no son marcadores de posición grises: son texto que se lee y
 *     que se puede tocar para arrancar de ahí;
 *   · y ninguna opción es obligatoria para cerrar una fase. Lo que cierra una
 *     fase es el DATO (cierre.ts), venga de un botón, de la voz, del teclado o
 *     de su página web.
 *
 *  ── Por qué vive aquí y no en el `.tsx` ───────────────────────────────────
 *
 *  Porque tiene DOS lectores y tienen que ver exactamente lo mismo:
 *
 *    1. La pantalla, que los pinta (`VistaDelRitual.ayuda`).
 *    2. El modelo, al que el guion le dice qué botones tiene el invitado
 *       enfrente para que su pregunta sea la que esos botones contestan.
 *
 *  Con la lista escondida en la pantalla, el agente preguntaba «¿en qué etapa
 *  va tu negocio?» y abajo aparecían botones de categorías. El que se ve mal en
 *  esa foto es el agente, que es lo único que el producto tiene.
 *
 *  ── Los ejemplos son mexicanos y son reales ───────────────────────────────
 *
 *  «Vendo tacos de canasta en la Roma y también hago pedidos para oficinas»
 *  enseña qué clase de respuesta sirve. «Describe tu negocio» no enseña nada, y
 *  «Ej: Soy proveedor de soluciones» enseña a contestar mal. Cada ejemplo de
 *  aquí es un negocio que existe en México y está escrito como habla su dueño.
 */
import type { AyudaDeRespuesta, EstadoNegocio, Fase, OpcionRapida } from '../types';
import { primerFaltante } from './cierre';

// ════════════════════════════════════════════════════════════════════════════
// Atajos de escritura
// ════════════════════════════════════════════════════════════════════════════

/** Etiqueta y valor iguales: el caso normal. */
const o = (texto: string): OpcionRapida => ({ valor: texto, etiqueta: texto });

/** Etiqueta corta para el botón, respuesta completa para el agente. */
const oo = (etiqueta: string, valor: string): OpcionRapida => ({ valor, etiqueta });

interface Plantilla {
  titulo: string;
  opciones?: OpcionRapida[];
  multiple?: boolean;
  abierta?: boolean;
  ejemplos?: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// La tabla
// ════════════════════════════════════════════════════════════════════════════

/**
 * Una entrada por clave de `cierre.ts`. Lo que no está aquí, no tiene ayuda —
 * y está bien: `hito_del_diablo` es trabajo del agente, no del invitado.
 */
const AYUDAS: Record<string, Plantilla> = {
  // ── Fase 0 · el bautizo ───────────────────────────────────────────────────
  //
  // Ponerle nombre a algo es la parte bonita y también la que congela a la
  // gente. Cinco nombres a un toque quitan el bloqueo sin quitarle la decisión:
  // el campo sigue abierto y la mayoría acaba escribiendo el suyo — pero
  // empieza, que es lo que importa en el primer minuto.
  agente: {
    titulo: 'O escoge uno de estos',
    opciones: [o('Sol'), o('Tadeo'), o('Nica'), o('Lupita'), o('Emi')],
    abierta: true,
  },

  // ── Fase 1 · lo esencial ──────────────────────────────────────────────────
  categoria: {
    titulo: 'Toca la que más se parezca',
    opciones: [
      oo('Taquería o restaurante', 'Es una taquería / restaurante'),
      oo('Consultorio o salud', 'Es un consultorio o algo de salud'),
      oo('Tienda o retail', 'Es una tienda / retail'),
      oo('Servicios profesionales', 'Doy servicios profesionales'),
      oo('Belleza o estética', 'Es de belleza / estética'),
      oo('Oficio o reparación', 'Es un oficio o reparación'),
      oo('Eventos o banquetes', 'Es de eventos / banquetes'),
      oo('Cursos o educación', 'Doy cursos / educación'),
      oo('Venta en línea', 'Vendo en línea'),
    ],
    abierta: true,
  },

  equipo: {
    titulo: '¿Cuántos son hoy?',
    opciones: [
      oo('Solo yo', 'Solo yo'),
      oo('2 a 5', 'Somos de 2 a 5'),
      oo('6 a 20', 'Somos de 6 a 20'),
      oo('Más de 20', 'Somos más de 20'),
    ],
    abierta: true,
  },

  giro: {
    titulo: 'Cuéntamelo como se lo contarías a un amigo',
    ejemplos: [
      'Vendo tacos de canasta en la Roma y también surto pedidos para oficinas',
      'Renovamos baños y cocinas en casas de Satélite, de principio a fin',
      'Doy consulta de nutrición en línea a mujeres después del embarazo',
    ],
    abierta: true,
  },

  etapa: {
    titulo: '¿En qué punto va?',
    opciones: [
      oo('Apenas es una idea', 'Apenas es una idea'),
      oo('Primeros clientes', 'Ya tengo mis primeros clientes'),
      oo('Ya opera parejo', 'Ya opera parejo'),
      oo('Está creciendo', 'Está creciendo'),
    ],
    abierta: true,
  },

  // ── Fase 2 · cómo gana dinero ─────────────────────────────────────────────
  nicho: {
    titulo: 'Piensa en el último cliente que tuviste',
    ejemplos: [
      'Oficinas de la zona: piden comida para juntas de 10 o 20 personas',
      'Familias de Coyoacán que ya tienen casa y quieren remodelar de a poco',
      'Dueñas de salones chiquitos que me compran producto cada quincena',
    ],
    abierta: true,
  },

  modelo_ingreso: {
    titulo: '¿Cómo cobras?',
    opciones: [
      oo('Por pieza o platillo', 'Cobro por pieza / por platillo'),
      oo('Por proyecto', 'Cobro por proyecto'),
      oo('Mensualidad', 'Cobro una mensualidad / suscripción'),
      oo('Por hora', 'Cobro por hora'),
      oo('Por comisión', 'Cobro comisión'),
      oo('Por paquete', 'Vendo paquetes'),
    ],
    abierta: true,
  },

  ticket: {
    titulo: 'Un número aproximado basta. Un rango también.',
    ejemplos: [
      'Como $180 por persona; una mesa de cuatro deja $700',
      'Entre $35,000 y $60,000 por remodelación, según el tamaño',
      '$1,200 la consulta, y el paquete de tres sale en $3,000',
    ],
    abierta: true,
  },

  // Que no sepa su margen ES un dato, y hasta hoy era el que más atoraba la
  // entrevista: la persona no quería contestar mal y dejaba de contestar. Con
  // «No lo sé todavía» a un toque, no saber deja de ser un callejón.
  margen: {
    titulo: 'A ojo de buen cubero está bien',
    opciones: [
      oo('Como la mitad', 'Me queda como la mitad'),
      oo('Como 30%', 'Me queda como un 30%'),
      oo('Menos del 20%', 'Me queda menos del 20%'),
      oo('No lo sé todavía', 'La verdad no sé cuánto me queda'),
    ],
    abierta: true,
  },

  canales: {
    titulo: 'Toca todos los que uses',
    opciones: [
      o('WhatsApp'),
      o('Instagram'),
      o('Facebook'),
      oo('De boca en boca', 'Recomendación de boca en boca'),
      oo('Llegan al local', 'Llegan caminando al local'),
      oo('Página web', 'Mi página web'),
      o('TikTok'),
      oo('Marketplace', 'Marketplace / Mercado Libre'),
      oo('Por teléfono', 'Me hablan por teléfono'),
    ],
    multiple: true,
    abierta: true,
  },

  // ── Fase 3 · el proceso ───────────────────────────────────────────────────
  recorrido: {
    titulo: 'De que te buscan hasta que te pagan',
    ejemplos: [
      'Me escriben por WhatsApp → paso precios → me depositan → mando el pedido',
      'Ven el anuncio → agendan cita → vienen al consultorio → cobro en el momento',
      'Piden cotización → voy a medir → mando presupuesto → si dicen que sí, agendo la obra',
    ],
    abierta: true,
  },

  herramientas: {
    titulo: 'Toca con lo que trabajas hoy',
    opciones: [
      o('WhatsApp'),
      oo('Excel', 'Excel u hojas de cálculo'),
      oo('Una libreta', 'Una libreta'),
      oo('Mi memoria', 'La memoria, la verdad'),
      o('Instagram'),
      oo('Punto de venta', 'Un punto de venta'),
      oo('Facturación', 'Un sistema de facturación'),
      oo('Calendario', 'Google Calendar'),
    ],
    multiple: true,
    abierta: true,
  },

  // ── Fase 4 · la gente ─────────────────────────────────────────────────────
  equipo_detalle: {
    titulo: 'Con una línea basta',
    ejemplos: [
      'Mi esposa lleva la caja y yo cocino; un chavo ayuda los fines de semana',
      'Lo primero que soltaría es contestar WhatsApp: se me va la mañana ahí',
      'Somos dos vendedores y una persona de administración, y yo veo todo lo demás',
    ],
    abierta: true,
  },

  // ── Fase 5 · dónde se rompe ───────────────────────────────────────────────
  dolores: {
    titulo: 'Piensa en el peor sábado del año',
    ejemplos: [
      'Los sábados me llegan 20 mensajes y contesto hasta la noche; ya perdí pedidos',
      'No sé cuánto me queda al mes: junto los tickets y nunca los sumo',
      'Cuando me enfermo no cotiza nadie y la semana se me cae completa',
    ],
    abierta: true,
  },
};

// ════════════════════════════════════════════════════════════════════════════
// La consulta
// ════════════════════════════════════════════════════════════════════════════

function materializar(clave: string, p: Plantilla): AyudaDeRespuesta {
  return {
    clave,
    titulo: p.titulo,
    opciones: p.opciones ?? [],
    multiple: p.multiple ?? false,
    abierta: p.abierta ?? true,
    ejemplos: p.ejemplos ?? [],
  };
}

/** La ayuda de un dato concreto, o `null` si ese dato no tiene. */
export function ayudaDe(clave: string): AyudaDeRespuesta | null {
  const plantilla = AYUDAS[clave];
  return plantilla ? materializar(clave, plantilla) : null;
}

/**
 * La ayuda que le toca a este turno: la del PRIMER dato que falta en la fase.
 *
 * Es el mismo dato que el guion pone al frente de «lo que falta para cerrar»,
 * así que la pantalla y el agente van sincronizados por construcción y no por
 * coincidencia. Cuando la fase ya no debe nada —o es la síntesis— no hay ayuda:
 * el invitado está leyendo su mapa, no contestando.
 */
export function ayudaDelTurno(fase: Fase, estado: EstadoNegocio): AyudaDeRespuesta | null {
  const clave = primerFaltante(fase, estado);
  return clave ? ayudaDe(clave) : null;
}

/**
 * El bloque del guion que le dice al modelo qué botones tiene el invitado.
 *
 * Sin esto, la ayuda sería una lista de sugerencias que aparece debajo de una
 * pregunta que no las pidió. Con esto, el modelo sabe que preguntar «¿de qué es
 * tu negocio?» hace que nueve botones sean una respuesta de un toque — y sabe
 * también que NO debe enumerarlos en su texto, porque el invitado ya los ve.
 */
export function bloqueDeAyuda(ayuda: AyudaDeRespuesta | null): string | null {
  if (!ayuda) return null;

  const partes: string[] = [];

  if (ayuda.opciones.length > 0) {
    partes.push(
      `El invitado tiene ESTOS BOTONES en pantalla ahora mismo${ayuda.multiple ? ' (puede tocar varios)' : ''}:\n` +
        ayuda.opciones.map((op) => `  · ${op.etiqueta}`).join('\n'),
      'Haz tu pregunta de forma que tocar uno de esos botones SEA la respuesta. **No los enumeres ' +
        'en tu texto**: ya los está viendo, y repetirlos hace que tu mensaje se lea como un ' +
        'formulario. Si toca uno, te va a llegar como si lo hubiera escrito él.',
    );
    if (ayuda.abierta) {
      partes.push('También puede escribir lo suyo. Si lo hace, eso manda sobre cualquier botón.');
    }
  }

  if (ayuda.ejemplos.length > 0) {
    partes.push(
      'Y tiene estos ejemplos a la vista, para saber qué clase de respuesta sirve:\n' +
        ayuda.ejemplos.map((e) => `  · "${e}"`).join('\n'),
      'No los repitas ni los uses como si fueran suyos. Están ahí para que él no empiece en blanco.',
    );
  }

  return partes.length > 0 ? partes.join('\n\n') : null;
}
