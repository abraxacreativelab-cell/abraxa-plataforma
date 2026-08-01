/**
 * El vocabulario del Ritual.
 *
 * Nada aquí importa nada de runtime: estos tipos los comparten el motor, las
 * rutas, la síntesis y la UI, y todos tienen que poder importarlos sin
 * arrastrar Express ni la base de datos.
 */
import type { AreaState } from '@abraxa/db';

// ════════════════════════════════════════════════════════════════════════════
// Las fases
// ════════════════════════════════════════════════════════════════════════════

/** Las 7 fases del handoff §5, en orden. */
export type Fase =
  | 'bienvenida'
  | 'identidad'
  | 'modelo'
  | 'proceso'
  | 'dolor'
  | 'gente'
  | 'sintesis';

/**
 * En qué punto está la sesión.
 *
 * `cerrando` es la fase 6 en curso, y existe porque sin él ese minuto no se
 * podía distinguir de 'activa'. Ver migración 052: se escribe en el mismo
 * UPDATE que lleva la fase a 'sintesis' —antes de guardar el blueprint, sembrar
 * el giro o mandar el documento madre— y es lo que impide que una segunda
 * petición vuelva a correr la fase 6 entera.
 */
export type EstadoSesion = 'activa' | 'pausada' | 'cerrando' | 'completada';

// ════════════════════════════════════════════════════════════════════════════
// Lo que se extrae del negocio
// ════════════════════════════════════════════════════════════════════════════

/** Un paso del recorrido del cliente, tal como lo contó el emprendedor. */
export interface PasoDelProceso {
  /** "primer contacto", "cotización", "cierre"… con sus palabras. */
  nombre: string;
  /** Cómo lo hace hoy: por WhatsApp, en una libreta, en Excel. */
  como?: string;
}

/** Algo que le roba tiempo o dinero. Sale de la fase 4. */
export interface Dolor {
  texto: string;
  /** Área a la que apunta, si el agente la identificó. */
  areaSlug?: string;
}

/** Un hito del roadmap. */
export interface Hito {
  areaSlug: string;
  titulo: string;
  detalle?: string;
  /**
   * De dónde salió.
   *
   * `abogado_del_diablo` es el que importa: marca lo que el emprendedor NO
   * pidió y el agente detectó atacando su proceso. Es el criterio #8.
   */
  origen: 'emprendedor' | 'abogado_del_diablo' | 'catalogo';
}

/**
 * Todo lo que el Ritual sabe del negocio. Es la columna `state` de la sesión.
 *
 * Todos los campos son opcionales a propósito: una sesión a medias es el estado
 * NORMAL de esta estructura, no una excepción. Las condiciones de cierre de
 * cada fase (interview/cierre.ts) son las que dicen qué hace falta para
 * avanzar, y viven en un solo lugar.
 */
export interface EstadoNegocio {
  // fase 0 — bienvenida
  /** El nombre que el emprendedor le puso a SU agente. */
  agente?: string;

  // fase 1 — lo esencial
  /**
   * La categoría gruesa del negocio, de un toque.
   *
   * Es el primer dato del Ritual desde el 2026-08-01 y existe justamente por
   * eso: es lo único de la identidad de una empresa que se puede contestar con
   * el pulgar. "Taquería o restaurante" no es el giro —eso lo cuenta él con sus
   * palabras dos preguntas después— pero es suficiente para que el mapa deje de
   * ser genérico si el invitado se sale en el minuto uno.
   */
  categoria?: string;
  giro?: string;
  /** idea | primeros_clientes | operando | creciendo */
  etapa?: string;
  /**
   * Cuánta gente son hoy, en cubetas: "solo yo", "2 a 5", "6 a 20", "más de 20".
   *
   * Vive en la fase 1 desde el 2026-08-01 —antes cerraba la fase de gente— y el
   * motivo es de producto: el número de empleados se contesta con un botón y
   * cambia el mapa (el área de Equipo nace abierta o con candado según esto).
   * Un dato de un segundo que mueve el resultado va al principio, no al final.
   */
  equipo?: string;

  // fase 2 — modelo
  nicho?: string;
  /** Cómo gana dinero: por proyecto, por mensualidad, por comisión… */
  modeloIngreso?: string;
  ticket?: string;
  margen?: string;
  /** Canales por los que le llegan clientes hoy. */
  canales?: string[];
  /**
   * Volumen de hoy: clientes al mes, ventas, lo que él use de medida.
   *
   * Dejó de ser condición de cierre el 2026-08-01. No se pierde —se sigue
   * guardando cuando lo suelta, y sigue viajando al agente y al documento
   * madre—; lo que se quitó es el poder de detener la entrevista, porque es el
   * único dato de la fase que no se puede contestar con el pulgar y que además
   * ya está implícito en el ticket y en el giro.
   */
  tamano?: string;

  // fase 3 — proceso
  recorrido?: PasoDelProceso[];
  herramientas?: string[];

  // fase 4 — gente
  /** Quién hace qué, o qué sería lo primero que soltaría si pudiera pagarle a alguien. */
  equipoDetalle?: string;

  // fase 5 — dolor
  dolores?: Dolor[];

  // transversal
  hitos?: Hito[];
  /** Áreas que el agente propuso explícitamente durante la conversación. */
  areasPropuestas?: PropuestaDeArea[];
  /** Cualquier dato suelto que el agente quiso guardar y no tiene campo. */
  extra?: Record<string, string>;

  /**
   * Estado de la CONVERSACIÓN, no del negocio.
   *
   * Va en la misma columna porque un turno se guarda entero o no se guarda —
   * partirlo en dos escrituras es exactamente lo que `repositorio.ts` evita—,
   * pero se mantiene aparte del resto para que nunca se cuele al bloque «LO QUE
   * YA SABES» del prompt como si fuera un dato de la empresa.
   */
  senales?: {
    /** El modelo pidió cerrar la fase anterior y no se le concedió. */
    cierreDenegado?: boolean;
  };
}

export interface PropuestaDeArea {
  slug: string;
  estado: AreaState;
  razon?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// La conversación
// ════════════════════════════════════════════════════════════════════════════

export interface TurnoTranscrito {
  role: 'user' | 'assistant';
  /** Ya limpio de marcadores. Lo que se guarda es lo que se vio. */
  content: string;
  at: string;
  fase: Fase;
}

/** La sesión completa, como sale de la base. */
export interface SesionRitual {
  id: string;
  tenantId: string;
  fase: Fase;
  estado: EstadoNegocio;
  transcript: TurnoTranscrito[];
  status: EstadoSesion;
  checkpointAt: string | null;
  completedAt: string | null;
  turnos: number;
  /**
   * El id del último ENVÍO que se aplicó, tal como lo generó el navegador.
   *
   * No es el número de turno: es de qué envío vino. Un reenvío trae el mismo id
   * y por eso se puede reconocer. Ver `OpcionesDeRespuesta.turnoId`.
   */
  ultimoEnvio: string | null;
  createdAt: string;
  updatedAt: string;
}

// ════════════════════════════════════════════════════════════════════════════
// El Mapa de Negocio
// ════════════════════════════════════════════════════════════════════════════

export interface AreaDelMapa {
  slug: string;
  label: string;
  estado: AreaState;
  /** Qué le promete al emprendedor. Se muestra INCLUSO si está bloqueada. */
  blurb: string;
  position: number;
  /** Por qué el agente la puso así, con los datos de SU negocio. */
  razon: string;
  /** Condiciones evaluables para abrirla. Vocabulario de H11 §5. */
  requisitos: RequisitoDeArea[];
}

/**
 * Una condición de desbloqueo, en datos y no en código.
 *
 * H11 §5 lo pide explícito: `{ type: 'has_channel' }`, `{ type: 'value_count',
 * min: 3 }`. El Ritual propone las suyas; H11 las evalúa.
 */
export interface RequisitoDeArea {
  type: string;
  min?: number;
  /** Cómo se le explica al emprendedor. */
  label: string;
}

export interface MapaDeNegocio {
  industryType: string | null;
  areas: AreaDelMapa[];
  hitos: Hito[];
  /** El documento madre: el resumen de su negocio en prosa. */
  resumen: string;
}

/** Un blueprint ya persistido. */
export interface BlueprintGuardado extends MapaDeNegocio {
  id: string;
  tenantId: string;
  sessionId: string;
  version: number;
  appliedAt: string | null;
  appliedBy: string | null;
  applyError: string | null;
  /**
   * El acuse de la bóveda: el id del documento madre que YA se ingirió.
   *
   * Lleno = no se vuelve a mandar. Es la llave de idempotencia de
   * `VaultPort.ingestDocument()`, que vive aquí porque el port es de H1 y no
   * recibe ninguna. Ver migración 052 §4.
   */
  vaultDocumentId: string | null;
  createdAt: string;
}

// ════════════════════════════════════════════════════════════════════════════
// Lo que devuelve un turno
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// Las ayudas de respuesta
// ════════════════════════════════════════════════════════════════════════════

/** Un botón de respuesta rápida. */
export interface OpcionRapida {
  /** Lo que se manda como si él lo hubiera escrito. */
  valor: string;
  /** Lo que se lee en el botón. Corto: cabe en un pulgar. */
  etiqueta: string;
}

/**
 * Lo que la pantalla le ofrece al invitado para contestar sin teclado.
 *
 * ── Por qué esto es un DATO y no una lista escondida en la UI ──────────────
 *
 * Porque hay dos lectores y tienen que ver lo mismo. La pantalla pinta los
 * botones; el guion se los dice al modelo para que su pregunta sea la que esos
 * botones contestan. Con la lista en el `.tsx`, el agente preguntaba una cosa y
 * el invitado veía botones de otra —y el que se ve mal es el agente—.
 *
 * Una sola tabla (`interview/ayudas.ts`), dos consumidores.
 */
export interface AyudaDeRespuesta {
  /** El dato que esta ayuda viene a llenar: `categoria`, `equipo`, `giro`… */
  clave: string;
  /** Encabezado corto arriba de los botones. */
  titulo: string;
  opciones: OpcionRapida[];
  /** `true` si puede elegir varias (canales, herramientas). */
  multiple: boolean;
  /** `true` si además puede escribir lo suyo. Los botones ayudan, no encierran. */
  abierta: boolean;
  /**
   * Ejemplos VISIBLES para una pregunta abierta. No son marcadores de posición:
   * se leen, enseñan qué clase de respuesta sirve y se pueden tocar para usarlos
   * como punto de partida.
   */
  ejemplos: string[];
}

export interface VistaDelRitual {
  fase: Fase;
  faseIndice: number;
  fasesTotales: number;
  /** 0–100. Cuenta fases cerradas, no mensajes: no puede retroceder. */
  progreso: number;
  tituloDeFase: string;
  status: EstadoSesion;
  /** El nombre que le puso a su agente, o null si aún no lo bautiza. */
  agente: string | null;
  turnos: number;
  checkpointAt: string | null;
  /** Qué le falta a la fase actual para cerrar. La UI lo puede enseñar. */
  faltante: string[];
  /** Botones y ejemplos para el dato que se está pidiendo AHORA. */
  ayuda: AyudaDeRespuesta | null;
}

// ════════════════════════════════════════════════════════════════════════════
// Leer su página
// ════════════════════════════════════════════════════════════════════════════

/**
 * Un dato que salió de su página y que él todavía no ha confirmado.
 *
 * Nada de esto entra al estado del negocio por su cuenta: se le enseña, lo
 * corrige si hace falta y sólo entonces se manda como si lo hubiera dicho él.
 * Un dato que el sistema da por cierto sin que el dueño lo vea es un dato que
 * el dueño va a desmentir en la primera conversación con su agente.
 */
export interface PropuestaDelSitio {
  /** `categoria`, `giro`, `nicho`, `canales`… */
  clave: string;
  /** Cómo se le nombra al invitado. */
  etiqueta: string;
  valor: string;
}

export type TipoDeEnlace = 'sitio' | 'red-social';

export interface LecturaDelSitio {
  /** La URL que de verdad se leyó, ya normalizada. */
  url: string;
  tipo: TipoDeEnlace;
  /** `@lataqueriadelbarrio` cuando el enlace es de una red social. */
  handle: string | null;
  /** El nombre de la red: instagram, facebook, tiktok… */
  red: string | null;
  /** `true` si se sacó algo aprovechable. `false` NUNCA es un error en pantalla. */
  sirvio: boolean;
  /** Lo que se le va a enseñar para que lo confirme. Puede venir vacío. */
  propuestas: PropuestaDelSitio[];
  /** Lo que el agente le dice. Siempre digno, nunca "falló algo". */
  mensaje: string;
}

export interface RespuestaDelRitual {
  /** El mensaje visible. Sin un solo marcador. */
  mensaje: string;
  vista: VistaDelRitual;
  /** `true` si este turno cerró una fase. */
  avanzo: boolean;
  /** El mapa, sólo cuando el Ritual termina. */
  mapa: MapaDeNegocio | null;
}
