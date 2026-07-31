/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El catálogo: lo que la paleta del builder puede ofrecer.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  UNA SOLA LISTA para tres consumidores: la paleta del builder, el prompt del
 *  asistente y el validador. Que sea la misma es la forma mecánica de cumplir
 *  la ley de GARDEN —"la UI no promete ningún nodo que el worker no corra"—:
 *  un nodo nuevo se agrega aquí, y si el motor no lo ejecuta, su propia prueba
 *  de cobertura falla (`catalog.test.ts`).
 *
 *  Sin dependencias: lo importa el navegador tal cual.
 */
import type { TriggerType } from '@abraxa/db';
import type { DefinicionDeNodo } from './types';

/** Los diez nodos que hacen algo, más el trigger estructural. */
export const CATALOGO: readonly DefinicionDeNodo[] = [
  {
    tipo: 'trigger',
    etiqueta: 'Cuando pase esto',
    resumen: 'Por dónde entra el flujo. Va uno solo y no se puede quitar.',
    icono: 'zap',
    campos: [],
  },
  {
    tipo: 'send_message',
    etiqueta: 'Mandar un mensaje',
    resumen: 'Le escribe al contacto por el canal que elijas. Acepta variables.',
    icono: 'send',
    campos: [
      {
        clave: 'channel',
        etiqueta: 'Canal',
        tipo: 'opcion',
        requerido: true,
        opciones: [
          { valor: 'whatsapp', etiqueta: 'WhatsApp' },
          { valor: 'email', etiqueta: 'Correo' },
          { valor: 'sms', etiqueta: 'SMS' },
          { valor: 'instagram', etiqueta: 'Instagram' },
          { valor: 'messenger', etiqueta: 'Messenger' },
        ],
        ayuda: 'Quien lo entrega es la bandeja (H6). Los canales de H12 y H13 aparecen solos.',
      },
      {
        clave: 'to',
        etiqueta: 'Para quién',
        tipo: 'opcion',
        opciones: [
          { valor: 'contact', etiqueta: 'El contacto' },
          { valor: 'owner', etiqueta: 'Su responsable' },
        ],
        ayuda: 'También acepta una dirección fija escrita como address:+52…',
      },
      {
        clave: 'template',
        etiqueta: 'Mensaje',
        tipo: 'texto-largo',
        requerido: true,
        ayuda: 'Variables: {nombre} {fecha} {hora} {vendedor} {link} y {valor.*} / {precio.*} de la bóveda.',
      },
    ],
  },
  {
    tipo: 'wait',
    etiqueta: 'Esperar',
    resumen: 'Deja pasar un rato antes del siguiente paso.',
    icono: 'clock',
    campos: [
      {
        clave: 'minutes',
        etiqueta: 'Minutos',
        tipo: 'numero',
        requerido: true,
        ayuda: '60 = una hora. 1440 = un día.',
      },
    ],
  },
  {
    tipo: 'condition',
    etiqueta: 'Si pasa esto…',
    resumen: 'Parte el flujo en dos caminos según un dato del contacto o del evento.',
    icono: 'git-branch',
    bifurca: true,
    campos: [
      {
        clave: 'field',
        etiqueta: 'Campo',
        tipo: 'texto',
        requerido: true,
        ayuda: 'lifecycle, owner_email, tag, o cualquier variable del evento.',
      },
      {
        clave: 'op',
        etiqueta: 'Comparación',
        tipo: 'opcion',
        opciones: [
          { valor: 'eq', etiqueta: 'es igual a' },
          { valor: 'neq', etiqueta: 'no es igual a' },
          { valor: 'contains', etiqueta: 'contiene' },
          { valor: 'in', etiqueta: 'está en la lista' },
          { valor: 'not_empty', etiqueta: 'tiene algo' },
          { valor: 'empty', etiqueta: 'está vacío' },
        ],
      },
      { clave: 'value', etiqueta: 'Valor', tipo: 'texto' },
    ],
  },
  {
    tipo: 'assign_owner',
    etiqueta: 'Asignar responsable',
    resumen: 'Le pone dueño al contacto: alguien de tu equipo.',
    icono: 'user-check',
    campos: [
      {
        clave: 'owner_email',
        etiqueta: 'Correo del responsable',
        tipo: 'texto',
        ayuda: 'Déjalo vacío y usa "repartir" para turnarlo entre el equipo.',
      },
      {
        clave: 'pool',
        etiqueta: 'Repartir entre',
        tipo: 'opcion',
        opciones: [
          { valor: '', etiqueta: 'Nadie: usar el correo de arriba' },
          { valor: 'equipo', etiqueta: 'Todo el equipo' },
        ],
      },
    ],
  },
  {
    tipo: 'move_stage',
    etiqueta: 'Mover de etapa',
    resumen: 'Lo empuja en el embudo: de Nuevo a Contactado, por ejemplo.',
    icono: 'columns-3',
    campos: [
      {
        clave: 'stage',
        etiqueta: 'Etapa',
        tipo: 'texto',
        requerido: true,
        ayuda: 'El nombre corto de la etapa o su id. El CRM resuelve los dos.',
      },
      { clave: 'pipeline', etiqueta: 'Embudo', tipo: 'texto', ayuda: 'Vacío = el embudo por defecto.' },
    ],
  },
  {
    tipo: 'add_tag',
    etiqueta: 'Poner etiqueta',
    resumen: 'Le pega una etiqueta al contacto.',
    icono: 'tag',
    campos: [{ clave: 'tag', etiqueta: 'Etiqueta', tipo: 'texto', requerido: true }],
  },
  {
    tipo: 'create_task',
    etiqueta: 'Crear tarea',
    resumen: 'Le deja pendiente a alguien de tu equipo.',
    icono: 'check-square',
    campos: [
      { clave: 'title', etiqueta: 'Título', tipo: 'texto', requerido: true },
      { clave: 'description', etiqueta: 'Detalle', tipo: 'texto-largo' },
      {
        clave: 'assign_to',
        etiqueta: 'Para quién',
        tipo: 'texto',
        ayuda: 'Un correo, u "owner" para el responsable del contacto.',
      },
      { clave: 'due_in_min', etiqueta: 'Vence en (minutos)', tipo: 'numero' },
    ],
  },
  {
    tipo: 'webhook',
    etiqueta: 'Llamar a otro sistema',
    resumen: 'Manda los datos de la corrida a una URL tuya.',
    icono: 'webhook',
    campos: [
      {
        clave: 'url',
        etiqueta: 'URL',
        tipo: 'texto',
        requerido: true,
        ayuda: 'Tiene que ser https y pública: las direcciones internas están bloqueadas.',
      },
      {
        clave: 'method',
        etiqueta: 'Método',
        tipo: 'opcion',
        opciones: [
          { valor: 'POST', etiqueta: 'POST' },
          { valor: 'GET', etiqueta: 'GET' },
          { valor: 'PUT', etiqueta: 'PUT' },
        ],
      },
    ],
  },
  {
    tipo: 'ai_step',
    etiqueta: 'Preguntarle a un agente',
    resumen: 'Tu agente lee el contexto y escribe algo. Queda en la ficha del contacto.',
    icono: 'sparkles',
    campos: [
      { clave: 'prompt', etiqueta: 'Instrucción', tipo: 'texto-largo', requerido: true },
      {
        clave: 'role',
        etiqueta: 'Qué agente',
        tipo: 'opcion',
        opciones: [
          { valor: 'sales', etiqueta: 'Ventas' },
          { valor: 'service', etiqueta: 'Atención' },
          { valor: 'analyst', etiqueta: 'Análisis' },
          { valor: 'master', etiqueta: 'El maestro' },
        ],
      },
    ],
  },
  {
    tipo: 'end',
    etiqueta: 'Terminar',
    resumen: 'Cierra la corrida aquí.',
    icono: 'circle-stop',
    termina: true,
    campos: [],
  },
];

/** Búsqueda por tipo. */
export const definicionDe = (tipo: string): DefinicionDeNodo | undefined =>
  CATALOGO.find((n) => n.tipo === tipo);

// ════════════════════════════════════════════════════════════════════════════
// Los disparadores, con su nombre en la lengua del emprendedor
// ════════════════════════════════════════════════════════════════════════════

export interface DefinicionDeDisparador {
  tipo: TriggerType;
  etiqueta: string;
  resumen: string;
  icono: string;
  /** Claves de `trigger_config` que este disparador entiende. */
  filtros: Array<{ clave: string; etiqueta: string; ayuda?: string }>;
  /**
   * Quién lo publica hoy. Vacío = **nadie todavía**, y la UI lo dice en vez de
   * ofrecer un disparador que jamás se va a activar. Es la misma ley de
   * GARDEN, aplicada a los disparadores y no sólo a los nodos.
   */
  emitidoPor: string;
}

export const DISPARADORES: readonly DefinicionDeDisparador[] = [
  {
    tipo: 'contact_created',
    etiqueta: 'Entra un contacto nuevo',
    resumen: 'Alguien te escribe o llena un formulario por primera vez.',
    icono: 'user-plus',
    filtros: [{ clave: 'source', etiqueta: 'Sólo de este origen', ayuda: 'whatsapp, formulario, import…' }],
    emitidoPor: 'H15 · CRM',
  },
  {
    tipo: 'stage_changed',
    etiqueta: 'Cambia de etapa',
    resumen: 'El contacto avanza (o retrocede) en el embudo.',
    icono: 'move-right',
    filtros: [
      { clave: 'stage', etiqueta: 'Sólo a esta etapa' },
      { clave: 'pipeline', etiqueta: 'Sólo en este embudo' },
    ],
    emitidoPor: 'H15 · CRM',
  },
  {
    tipo: 'tag_added',
    etiqueta: 'Le ponen una etiqueta',
    resumen: 'Alguien —o otro flujo— etiqueta al contacto.',
    icono: 'tag',
    filtros: [{ clave: 'tag', etiqueta: 'Sólo esta etiqueta' }],
    emitidoPor: 'H15 · CRM',
  },
  {
    tipo: 'form_submitted',
    etiqueta: 'Llenan un formulario',
    resumen: 'Llega un lead desde tu página.',
    icono: 'clipboard-list',
    filtros: [{ clave: 'form_id', etiqueta: 'Sólo este formulario' }],
    emitidoPor: 'H15 · CRM (quien reciba el formulario)',
  },
  {
    tipo: 'message_in',
    etiqueta: 'Te escriben',
    resumen: 'Entra un mensaje por cualquier canal.',
    icono: 'message-circle',
    filtros: [{ clave: 'channel', etiqueta: 'Sólo por este canal' }],
    emitidoPor: '',
  },
  {
    tipo: 'appointment_created',
    etiqueta: 'Agendan una cita',
    resumen: 'Alguien aparta un horario contigo.',
    icono: 'calendar-plus',
    filtros: [{ clave: 'calendar_id', etiqueta: 'Sólo este calendario' }],
    emitidoPor: '',
  },
  {
    tipo: 'appointment_cancelled',
    etiqueta: 'Cancelan una cita',
    resumen: 'Se cae una cita agendada.',
    icono: 'calendar-x',
    filtros: [{ clave: 'calendar_id', etiqueta: 'Sólo este calendario' }],
    emitidoPor: '',
  },
  {
    tipo: 'manual',
    etiqueta: 'Cuando yo lo diga',
    resumen: 'Sólo corre cuando tú lo lanzas o lo pruebas.',
    icono: 'hand',
    filtros: [],
    emitidoPor: 'H8 · el botón de probar',
  },
];

export const disparadorDe = (tipo: string): DefinicionDeDisparador | undefined =>
  DISPARADORES.find((d) => d.tipo === tipo);

/**
 * Los disparadores que hoy tienen quién los publique.
 *
 * La UI marca los demás como "todavía nadie lo dispara" en vez de dejar que el
 * emprendedor arme un flujo que nunca va a correr. Es la información honesta:
 * el flujo se guarda igual, y arranca solo el día que alguien emita el evento.
 */
export const disparadoresVivos = (): readonly DefinicionDeDisparador[] =>
  DISPARADORES.filter((d) => d.emitidoPor !== '');
