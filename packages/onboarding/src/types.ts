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

  // fase 1 — identidad
  giro?: string;
  nicho?: string;
  /** idea | primeros_clientes | operando | creciendo */
  etapa?: string;
  tamano?: string;

  // fase 2 — modelo
  /** Cómo gana dinero: por proyecto, por mensualidad, por comisión… */
  modeloIngreso?: string;
  ticket?: string;
  margen?: string;
  /** Canales por los que le llegan clientes hoy. */
  canales?: string[];

  // fase 3 — proceso
  recorrido?: PasoDelProceso[];
  herramientas?: string[];

  // fase 4 — dolor
  dolores?: Dolor[];

  // fase 5 — gente
  /** solo | equipo | contratando */
  equipo?: string;
  equipoDetalle?: string;

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
