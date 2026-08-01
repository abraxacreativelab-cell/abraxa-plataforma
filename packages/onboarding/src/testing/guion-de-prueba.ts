/**
 * Una entrevista completa, tal como la contestaría el modelo.
 *
 * Vive aparte porque ya son tres las pruebas que necesitan llegar hasta la
 * síntesis —la reanudación, el cierre re-entrante y el reenvío— y llegar hasta
 * la síntesis exige las siete respuestas con sus marcadores exactos. Tres copias
 * de esto es una copia que se queda vieja.
 *
 * ── El orden es el del embudo invertido (2026-08-01) ──────────────────────
 *
 *   bienvenida → identidad → modelo → proceso → gente → dolor → sintesis
 *
 * Y la fase 1 pide lo que se contesta con el pulgar: categoría, cuántos son,
 * giro y etapa. Ver `interview/fases.ts` y `interview/cierre.ts`.
 */

export const SALUDO =
  'Hola. Voy a ser tu agente, pero todavía no tengo nombre. ¿Cómo me quieres llamar?';

export const BAUTIZO = `Aura. Me gusta.

Va la primera, de un toque: ¿de qué es tu negocio?
[DATO:agente=Aura][FASE_COMPLETA:bienvenida]`;

export const IDENTIDAD = `Panadería artesanal, son dos, ya operando. Anotado.

[DATO:categoria=Es una panadería][DATO:equipo=Somos de 2 a 5]
[DATO:giro=panadería artesanal][DATO:etapa=operando]
[FASE_COMPLETA:identidad]`;

export const MODELO = `Perfecto: le vendes a cafeterías, pedido semanal recurrente, ticket de 4,500 al mes por cafetería, margen como del 35%.

[DATO:nicho=cafeterías independientes][DATO:modelo_ingreso=pedido semanal recurrente]
[DATO:ticket=4,500 al mes por cafetería][DATO:margen=35%][DATO:tamano=12 clientes fijos]
[LISTA:canales=whatsapp, recomendación]
[FASE_COMPLETA:modelo]`;

export const PROCESO = `Ya me quedó claro el recorrido.

[PASO:le escriben por WhatsApp|contesta él en el celular]
[PASO:cotiza el pedido|calculadora y memoria]
[PASO:entrega los lunes|camioneta propia]
[LISTA:herramientas=whatsapp, libreta]
[FASE_COMPLETA:proceso]`;

export const GENTE = `Entonces tú horneas y tu hermano entrega los lunes.

[DATO:equipo_detalle=su hermano apoya en la entrega de los lunes]
[FASE_COMPLETA:gente]`;

export const DOLOR = `Entonces los domingos en la noche se te juntan los pedidos y a veces uno se pierde entre los mensajes.

[DOLOR:se le pierden pedidos entre los mensajes del domingo|ventas]
[DOLOR:cotiza de memoria y a veces se equivoca de precio|direccion]
[HITO:ventas|Que los pedidos del domingo entren solos a una lista|Hoy dependen de que él alcance a leer todo]
[FASE_COMPLETA:dolor]`;

export const ENTREGA = 'Aquí está tu Mapa de Negocio. Empieza por Ventas.';

/** Las siete respuestas, en orden, desde el saludo hasta la entrega del mapa. */
export const ENTREVISTA_COMPLETA: readonly string[] = [
  SALUDO,
  BAUTIZO,
  IDENTIDAD,
  MODELO,
  PROCESO,
  GENTE,
  DOLOR,
  ENTREGA,
];

/**
 * Lo que la emprendedora teclea, en orden. Cinco mensajes la dejan en 'dolor',
 * a uno solo de la síntesis — que es justo donde empieza la prueba del cierre.
 */
export const HASTA_GENTE: readonly string[] = [
  'Aura',
  'panadería, somos dos',
  'cobro por pedido semanal',
  'me escriben por WhatsApp',
  'mi hermano entrega los lunes',
];

/** El mensaje que cierra la última fase y dispara la síntesis. */
export const ULTIMO_MENSAJE = 'los domingos se me juntan los pedidos y se me pierde alguno';

/** El catálogo de giros de H4 (migración 033), para que la resolución corra. */
export const PLANTILLAS_DE_GIRO = [
  { id: 'servicios', name: 'Servicios profesionales', blurb: 'Despachos, consultorios, talleres, salones, estudios.', position: 1 },
  { id: 'comercio', name: 'Comercio y tienda en linea', blurb: 'Vendes producto: local, tienda en linea, marketplace.', position: 2 },
  { id: 'restaurante', name: 'Restaurante y cafeteria', blurb: 'Cocinas y vendes en el momento: local, para llevar o reparto.', position: 3 },
  { id: 'agencia', name: 'Agencia o estudio', blurb: 'Vendes trabajo por proyecto o por iguala: marketing, diseno, software.', position: 4 },
  { id: 'general', name: 'Otro giro', blurb: 'Lo minimo que todo negocio necesita tener claro.', position: 9 },
];
