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

export type EstadoSesion = 'activa' | 'pausada' | 'completada';
export type AreaState = 'bloqueada' | 'disponible' | 'en_progreso' | 'activa';

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

/** Por qué la pantalla no puede hablar con su API. */
export interface Impedimento {
  /** `sesion` = falta H2. `puerto` = falta un port. `red` = la API no contesta. */
  tipo: 'sesion' | 'puerto' | 'red' | 'desconocido';
  mensaje: string;
}
