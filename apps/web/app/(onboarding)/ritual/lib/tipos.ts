/**
 * La forma de lo que devuelve `/onboarding` — repetida aquí a propósito.
 *
 * `apps/web` no declara `@abraxa/onboarding` como dependencia (su package.json
 * es de H1 y la regla 4 dice que nadie instala nada), y de todas formas no
 * convendría: ese paquete arrastra Express y el cliente de la base, que no
 * tienen por qué acercarse a un bundle de navegador.
 *
 * Así que el contrato de la pantalla con su API es este archivo. Son ~40 líneas
 * de tipos que cambian cuando cambia la API, no una dependencia que arrastra
 * medio backend a un `.tsx`.
 */
export type Fase =
  | 'bienvenida'
  | 'identidad'
  | 'modelo'
  | 'proceso'
  | 'dolor'
  | 'gente'
  | 'sintesis';

/**
 * `cerrando` es la fase 6 en curso: el Ritual ya tiene todo y está armando el
 * Mapa de Negocio. Dura entre 5 y 30 segundos y en la pantalla se ve como una
 * espera, no como un turno más — el compositor no sirve de nada mientras tanto.
 */
export type EstadoSesion = 'activa' | 'pausada' | 'cerrando' | 'completada';
export type AreaState = 'bloqueada' | 'disponible' | 'en_progreso' | 'activa';

/** Un botón de respuesta rápida. Lo decide el guion, lo pinta la pantalla. */
export interface OpcionRapida {
  /** Lo que se manda como si él lo hubiera escrito. */
  valor: string;
  /** Lo que se lee en el botón. */
  etiqueta: string;
}

/**
 * Los botones y ejemplos del dato que se está pidiendo AHORA.
 *
 * Viene del servidor en cada respuesta, y no de una tabla en este `.tsx`, por
 * una razón que se ve en la primera prueba: el agente tiene que preguntar
 * exactamente lo que estos botones contestan. Las dos puntas leen
 * `packages/onboarding/src/interview/ayudas.ts`.
 */
export interface Ayuda {
  clave: string;
  titulo: string;
  opciones: OpcionRapida[];
  multiple: boolean;
  abierta: boolean;
  ejemplos: string[];
}

export interface Vista {
  fase: Fase;
  faseIndice: number;
  fasesTotales: number;
  progreso: number;
  tituloDeFase: string;
  status: EstadoSesion;
  agente: string | null;
  turnos: number;
  checkpointAt: string | null;
  faltante: string[];
  ayuda: Ayuda | null;
}

/** Un dato que salió de su página y que él todavía no confirma. */
export interface PropuestaDelSitio {
  clave: string;
  etiqueta: string;
  valor: string;
}

/** Lo que contesta `POST /ritual/api/sitio`. Nunca es un error. */
export interface LecturaDelSitio {
  url: string;
  tipo: 'sitio' | 'red-social';
  handle: string | null;
  red: string | null;
  sirvio: boolean;
  propuestas: PropuestaDelSitio[];
  mensaje: string;
}

export interface Turno {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  fase: Fase;
}

export interface AreaDelMapa {
  slug: string;
  label: string;
  estado: AreaState;
  blurb: string;
  position: number;
  razon: string;
  requisitos: Array<{ type: string; min?: number; label: string }>;
}

export interface Hito {
  areaSlug: string;
  titulo: string;
  detalle?: string;
  origen: 'emprendedor' | 'abogado_del_diablo' | 'catalogo';
}

export interface Mapa {
  industryType: string | null;
  areas: AreaDelMapa[];
  hitos: Hito[];
  resumen: string;
}

export interface Foto {
  vista: Vista;
  transcript: Turno[];
  memoria: string;
  ausencia: string | null;
  mapa: Mapa | null;
  nuevo: boolean;
}

export interface RespuestaDelRitual {
  mensaje: string;
  vista: Vista;
  avanzo: boolean;
  mapa: Mapa | null;
}

/**
 * Por qué la pantalla no puede arrancar el Ritual.
 *
 * ── El detalle NO se le enseña a nadie (auditoría del 2026-07-31) ──────────
 *
 * En vivo, `/ritual` renderizaba una caja monoespaciada con
 * «identidadDeLaSesion() → null · lo cablea H2 · apps/web/app/(onboarding)/
 * ritual/lib/sesion.ts». Un invitado no sabe qué es H2 ni tiene ese repo: lo
 * único que lee es que el producto está a medio hacer. El diagnóstico sirve
 * —muchísimo— pero en el LOG del servidor, que es donde lo busca quien puede
 * hacer algo con él.
 */
export interface Impedimento {
  /**
   * `sesion`  = no hay quién esté entrando.
   * `empresa` = hay sesión y no se pudo resolver ni crear su empresa.
   * `puerto`  = falta un carril del que depende el Ritual.
   * `red`     = la API no contesta.
   */
  tipo: 'sesion' | 'empresa' | 'puerto' | 'red' | 'desconocido';
  /** Para el log del servidor. NUNCA se pinta. */
  detalle: string;
  /** A dónde manda el botón de entrar, si es que hay por dónde entrar hoy. */
  entrada?: string | null;
}
