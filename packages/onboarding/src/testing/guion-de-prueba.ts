/**
 * Una entrevista completa, tal como la contestaría el modelo.
 *
 * Vive aparte porque ya son tres las pruebas que necesitan llegar hasta la
 * síntesis —la reanudación, el cierre re-entrante y el reenvío— y llegar hasta
 * la síntesis exige las siete respuestas con sus marcadores exactos. Tres copias
 * de esto es una copia que se queda vieja.
 */

export const SALUDO =
  'Hola. Voy a ser tu agente, pero todavía no tengo nombre. ¿Cómo me quieres llamar?';

export const BAUTIZO = `Aura. Me gusta.

Ahora sí: cuéntame a qué te dedicas.
[DATO:agente=Aura][FASE_COMPLETA:bienvenida]`;

export const IDENTIDAD = `Entonces panadería artesanal para cafeterías de la ciudad, ya operando, unos 12 clientes fijos. Anotado.

[DATO:giro=panadería artesanal][DATO:nicho=cafeterías independientes][DATO:etapa=operando][DATO:tamano=12 clientes fijos]
[FASE_COMPLETA:identidad]`;

export const MODELO = `Perfecto: pedido semanal recurrente, ticket de 4,500 al mes por cafetería, margen como del 35%.

[DATO:modelo_ingreso=pedido semanal recurrente][DATO:ticket=4,500 al mes por cafetería][DATO:margen=35%]
[LISTA:canales=whatsapp, recomendación]
[FASE_COMPLETA:modelo]`;

export const PROCESO = `Ya me quedó claro el recorrido.

[PASO:le escriben por WhatsApp|contesta él en el celular]
[PASO:cotiza el pedido|calculadora y memoria]
[PASO:entrega los lunes|camioneta propia]
[LISTA:herramientas=whatsapp, libreta]
[FASE_COMPLETA:proceso]`;

export const DOLOR = `Entonces los domingos en la noche se te juntan los pedidos y a veces uno se pierde entre los mensajes.

[DOLOR:se le pierden pedidos entre los mensajes del domingo|ventas]
[DOLOR:cotiza de memoria y a veces se equivoca de precio|direccion]
[HITO:ventas|Que los pedidos del domingo entren solos a una lista|Hoy dependen de que él alcance a leer todo]
[FASE_COMPLETA:dolor]`;

export const GENTE = `Solo tú, con tu hermano ayudando los lunes.

[DATO:equipo=solo, con ayuda los lunes][DATO:equipo_detalle=su hermano apoya en la entrega]
[FASE_COMPLETA:gente]`;

export const ENTREGA = 'Aquí está tu Mapa de Negocio. Empieza por Ventas.';

/** Las siete respuestas, en orden, desde el saludo hasta la entrega del mapa. */
export const ENTREVISTA_COMPLETA: readonly string[] = [
  SALUDO,
  BAUTIZO,
  IDENTIDAD,
  MODELO,
  PROCESO,
  DOLOR,
  GENTE,
  ENTREGA,
];

/**
 * Lo que la emprendedora teclea, en orden. Cinco mensajes la dejan en 'gente',
 * a uno solo de la síntesis — que es justo donde empieza la prueba del cierre.
 */
export const HASTA_GENTE: readonly string[] = [
  'Aura',
  'pan artesanal',
  'cobro por pedido semanal',
  'me escriben por WhatsApp',
  'los domingos se me juntan',
];

/** El mensaje que cierra la fase 5 y dispara la síntesis. */
export const ULTIMO_MENSAJE = 'estoy solo, mi hermano ayuda los lunes';

/** El catálogo de giros de H4 (migración 033), para que la resolución corra. */
export const PLANTILLAS_DE_GIRO = [
  { id: 'servicios', name: 'Servicios profesionales', blurb: 'Despachos, consultorios, talleres, salones, estudios.', position: 1 },
  { id: 'comercio', name: 'Comercio y tienda en linea', blurb: 'Vendes producto: local, tienda en linea, marketplace.', position: 2 },
  { id: 'restaurante', name: 'Restaurante y cafeteria', blurb: 'Cocinas y vendes en el momento: local, para llevar o reparto.', position: 3 },
  { id: 'agencia', name: 'Agencia o estudio', blurb: 'Vendes trabajo por proyecto o por iguala: marketing, diseno, software.', position: 4 },
  { id: 'general', name: 'Otro giro', blurb: 'Lo minimo que todo negocio necesita tener claro.', position: 9 },
];
