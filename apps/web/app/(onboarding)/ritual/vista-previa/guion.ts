import type { Ayuda, Foto, Mapa, Turno, Vista } from '../lib/tipos';

/**
 * Datos de ejemplo para la vista previa. **No hay motor detrás**: es un
 * guion fijo con la forma exacta que devuelve `/onboarding/ritual`.
 *
 * Existe para poder ver y criticar la pantalla antes de que H2 cablee la
 * sesión, no para simular el producto. Por eso la página que lo usa se anuncia
 * como vista previa y devuelve 404 en producción.
 */
const AT = '2026-07-30T18:00:00.000Z';

const t = (role: Turno['role'], content: string, fase: Turno['fase'] = 'dolor'): Turno => ({
  role,
  content,
  at: AT,
  fase,
});

/**
 * La ayuda de la fase esencial, tal como la manda el servidor.
 *
 * Copiada a mano de `packages/onboarding/src/interview/ayudas.ts` porque esto
 * es un storyboard sin motor: la pantalla de verdad la recibe del servidor y
 * jamás la escribe. Si estas dos se separan, la que manda es la del paquete.
 */
export const AYUDA_CATEGORIA: Ayuda = {
  clave: 'categoria',
  titulo: 'Toca la que más se parezca',
  opciones: [
    { etiqueta: 'Taquería o restaurante', valor: 'Es una taquería / restaurante' },
    { etiqueta: 'Consultorio o salud', valor: 'Es un consultorio o algo de salud' },
    { etiqueta: 'Tienda o retail', valor: 'Es una tienda / retail' },
    { etiqueta: 'Servicios profesionales', valor: 'Doy servicios profesionales' },
    { etiqueta: 'Belleza o estética', valor: 'Es de belleza / estética' },
    { etiqueta: 'Oficio o reparación', valor: 'Es un oficio o reparación' },
  ],
  multiple: false,
  abierta: true,
  ejemplos: [],
};

export const AYUDA_DOLORES: Ayuda = {
  clave: 'dolores',
  titulo: 'Piensa en el peor sábado del año',
  opciones: [],
  multiple: false,
  abierta: true,
  ejemplos: [
    'Los sábados me llegan 20 mensajes y contesto hasta la noche; ya perdí pedidos',
    'No sé cuánto me queda al mes: junto los tickets y nunca los sumo',
    'Cuando me enfermo no cotiza nadie y la semana se me cae completa',
  ],
};

export const AYUDA_AGENTE: Ayuda = {
  clave: 'agente',
  titulo: 'O escoge uno de estos',
  opciones: ['Sol', 'Tadeo', 'Nica', 'Lupita', 'Emi'].map((n) => ({ etiqueta: n, valor: n })),
  multiple: false,
  abierta: true,
  ejemplos: [],
};

export const VISTA: Vista = {
  fase: 'dolor',
  faseIndice: 5,
  fasesTotales: 7,
  progreso: 71,
  tituloDeFase: 'Dónde se rompe',
  status: 'activa',
  agente: 'Aura',
  turnos: 11,
  checkpointAt: AT,
  faltante: ['al menos un hueco que TÚ detectaste atacando su proceso y que él no había pedido'],
  ayuda: AYUDA_DOLORES,
};

export const CONVERSACION: Turno[] = [
  t(
    'assistant',
    'Hola. Voy a ser tu agente: voy a vivir dentro de tu negocio, contestarle a tus clientes y ayudarte a ordenarlo.\n\nTodavía no tengo nombre. ¿Cómo me quieres llamar?',
    'bienvenida',
  ),
  t('user', 'Aura', 'bienvenida'),
  t(
    'assistant',
    'Aura. Me gusta.\n\nAhora sí: cuéntame a qué te dedicas. Con tus palabras, no con la categoría del SAT.',
    'identidad',
  ),
  t('user', 'Hago pan artesanal y lo vendo a cafeterías', 'identidad'),
  t(
    'assistant',
    'Entonces panadería artesanal, y tu cliente es la cafetería, no la persona que se come el pan. Eso cambia bastante.\n\n¿Cuántas cafeterías te compran hoy?',
    'identidad',
  ),
  t('user', '12 fijas, más o menos', 'identidad'),
  t(
    'assistant',
    'Doce fijas. ¿Y cómo les cobras: por pedido, por semana, un mínimo mensual?',
    'modelo',
  ),
  t('user', 'Por pedido, pero casi siempre me piden lo mismo cada semana', 'modelo'),
  t(
    'assistant',
    'O sea que en la práctica es una suscripción que nadie ha llamado suscripción. Anotado — eso vale.\n\nAhora cuéntame el recorrido completo: desde que una cafetería te busca hasta que te paga. Paso por paso.',
    'proceso',
  ),
  t('user', 'Me escriben por WhatsApp el domingo, cotizo, y entrego los lunes en la camioneta', 'proceso'),
  t(
    'assistant',
    'Me dijiste que los pedidos te llegan por WhatsApp el domingo en la noche.\n\nPregunta incómoda: ¿qué pasa el domingo que te escriben nueve cafeterías entre las 9 y las 11, y tú estás cenando con tu familia?',
  ),
];

export const MAPA: Mapa = {
  industryType: 'panaderia-artesanal',
  areas: [
    {
      slug: 'ventas',
      label: 'Ventas y marketing',
      estado: 'en_progreso',
      blurb: 'Un equipo de ventas que nunca duerme.',
      position: 1,
      razon:
        'Ya te llegan clientes por whatsapp y me describiste un recorrido de 3 pasos: aquí hay un embudo real que ordenar, no uno que inventar.',
      requisitos: [],
    },
    {
      slug: 'servicio',
      label: 'Servicio y atención',
      estado: 'disponible',
      blurb: 'Dejar de perder clientes por no contestar.',
      position: 2,
      razon:
        'Me dijiste esto: "los domingos se me juntan los pedidos y a veces uno se pierde". Eso no se arregla con más ganas.',
      requisitos: [],
    },
    {
      slug: 'direccion',
      label: 'Dirección',
      estado: 'disponible',
      blurb: 'Tus números en un solo lugar, para que nada más mienta.',
      position: 3,
      razon:
        'Ya me diste tu ticket (4,500 al mes por cafetería) y tu margen (35%). Esos números tienen que vivir en un solo lugar.',
      requisitos: [],
    },
    {
      slug: 'onboarding',
      label: 'Onboarding de clientes',
      estado: 'bloqueada',
      blurb: 'Cómo se siente entrar a tu negocio siendo cliente.',
      position: 4,
      razon: 'Se abre con tu primera venta cerrada aquí adentro.',
      requisitos: [{ type: 'first_sale', label: 'cerrar tu primera venta dentro del sistema' }],
    },
    {
      slug: 'rh',
      label: 'Equipo',
      estado: 'bloqueada',
      blurb: 'Graduarte de solopreneur.',
      position: 5,
      razon: 'Hoy estás tú. Esta área te espera el día que vayas a sumar a alguien.',
      requisitos: [{ type: 'declares_hiring', label: 'decir que vas a sumar a alguien' }],
    },
    {
      slug: 'finanzas',
      label: 'Finanzas',
      estado: 'bloqueada',
      blurb: 'Saber si de verdad ganas.',
      position: 6,
      razon: 'Ya operas, así que esto se abre pronto: en cuanto haya tres meses registrados.',
      requisitos: [
        { type: 'months_operating', min: 3, label: 'tener 3 meses de operación registrada' },
      ],
    },
  ],
  hitos: [
    {
      areaSlug: 'servicio',
      titulo: 'Que los pedidos del domingo entren solos a una lista',
      detalle: 'Hoy dependen de que alcances a leer todos los mensajes antes de dormirte.',
      origen: 'abogado_del_diablo',
    },
    {
      areaSlug: 'direccion',
      titulo: 'Fijar el precio por cafetería en un solo lugar',
      detalle: 'Hoy cotizas de memoria y a veces te equivocas.',
      origen: 'abogado_del_diablo',
    },
    {
      areaSlug: 'onboarding',
      titulo: 'Para abrir Onboarding de clientes: cerrar tu primera venta dentro del sistema',
      detalle: 'Cómo se siente entrar a tu negocio siendo cliente.',
      origen: 'catalogo',
    },
    {
      areaSlug: 'rh',
      titulo: 'Para abrir Equipo: decir que vas a sumar a alguien',
      detalle: 'Graduarte de solopreneur.',
      origen: 'catalogo',
    },
  ],
  resumen: '',
};

export const FOTO_REGRESO: Foto = {
  vista: VISTA,
  transcript: CONVERSACION,
  memoria:
    'Nos quedamos a medias ayer. Aquí sigo.\n\nEsto es lo que ya sé de tu negocio:\n· Te dedicas a panadería artesanal.\n· Le vendes a cafeterías independientes.\n· Tu ticket promedio anda en 4,500 al mes por cafetería.\n· Te escriben por whatsapp.\n\nVamos en la fase 5 de 7: dónde se rompe. Qué te roba tiempo y dinero. Aquí se pone incómodo.\n\n— Aura',
  ausencia: 'ayer',
  mapa: null,
  nuevo: false,
};
