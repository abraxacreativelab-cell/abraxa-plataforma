import type { AreaSummary } from '@abraxa/db/ports';
import { registerFallbackTools } from '../registry/tool-registry';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las áreas de arranque — lo que ve el emprendedor ANTES de que H11 exista
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Esto reemplaza al `MOCK_AREAS` anterior, y el cambio no es de forma. El mock
 *  tenía cuatro áreas inventadas y ocho rutas, de las cuales CUATRO no existían
 *  (`/ventas`, `/ventas/contactos`, `/ventas/pipeline`, `/servicio`). En
 *  desarrollo se anunciaba con una insignia; en producción no, porque el aviso
 *  sólo se pinta si `NODE_ENV !== 'production'`. O sea: el invitado veía cuatro
 *  enlaces muertos que parecían producto.
 *
 *  ── De dónde salen estos datos ─────────────────────────────────────────────
 *
 *  De `app.industry_templates.areas[]`, la semilla que YA está en la base y con
 *  la que H11 va a materializar el mapa de cada negocio. Se consultó producción
 *  el 2026-08-01: los cinco giros sembrados (servicios, comercio, restaurante,
 *  agencia, general) comparten `ventas`, `finanzas` y `direccion`; `general` —el
 *  que le toca a quien todavía no ha dicho a qué se dedica, o sea a todo
 *  invitado— trae exactamente estas cuatro. Los `blurb` son los de la semilla,
 *  con sus acentos puestos.
 *
 *  No hay una sola área inventada aquí. Cuando H11 registre `AreasPort`, esto
 *  deja de usarse solo, sin que cambie una línea del shell.
 *
 *  ── La regla que manda: una sección bloqueada es el GANCHO ──────────────────
 *
 *  «Tenemos que lograr que la parte de preguntas y respuestas sea mucho más
 *   rápida para no perder al cliente, y poder entregarle algo impresionante ya
 *   en la plataforma. Y después, con esa motivación y las ganas de desbloquear
 *   todas las nuevas áreas, que siga con las preguntas más específicas.»
 *
 *  Por eso NINGUNA sección se esconde. Las que no abren todavía se muestran con
 *  candado, con su promesa, y con **qué falta** dicho en una frase concreta. Y
 *  la frase no se inventa: cada área declara por cuál de los dos motivos reales
 *  está cerrada.
 *
 *    · `'ritual'`      — le falta información que el Ritual todavía no le ha
 *                        sacado. Se abre sola en cuanto cierre esa fase. Es el
 *                        motor del producto: para abrir Dirección hay que
 *                        contarle a qué te dedicas.
 *    · `'construccion'`— la estamos terminando nosotros. Decirlo así es lo
 *                        honesto; inventarle un requisito al invitado para que
 *                        se vea más "producto" sería mentirle en la cara.
 *
 *  El enganche para H7 es el argumento `senales`: en cuanto alguien le pase el
 *  progreso real del Ritual, las áreas se abren solas y nadie toca este archivo.
 */

// ════════════════════════════════════════════════════════════════════════════
// Las señales que abren un área
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lo que el shell sabe del Ritual de Fundación. Sale tal cual de
 * `GET /onboarding/ritual` → `vista` (H7), que está documentado como "sin
 * gastar un token".
 *
 * Si la foto no llegó se pasa `null`, y entonces el shell se comporta como si
 * el Ritual no hubiera empezado — el estado más conservador, y el único que no
 * puede abrirle a nadie un área que no le toca.
 */
export interface SenalesDelRitual {
  /** Cuántas fases lleva CERRADAS. Es `vista.faseIndice`, que es 0-based y por
   *  eso coincide con la cuenta de cerradas. */
  faseIndice: number;
  fasesTotales: number;
  /** `true` cuando el Ritual terminó: se abre todo lo que esté construido. */
  completado: boolean;
  /** El nombre que le puso a su agente. Entra en el texto del candado. */
  agente: string | null;
}

/** Por qué está cerrada un área. Decide QUÉ FRASE se pinta bajo el candado. */
export type MotivoDeCierre = 'ritual' | 'construccion';

export interface AreaDeArranque {
  slug: string;
  label: string;
  icon: string;
  position: number;
  blurb: string;
  /** Claves `"area:herramienta"` del registro. Vacío = todavía no hay pantalla. */
  tools: string[];
  /**
   * Cuántas fases del Ritual tienen que estar CERRADAS para que el área tenga
   * sentido. El orden canónico de las 7 vive en H7 (`interview/fases.ts`) y en
   * el CHECK de `app.onboarding_sessions.phase`:
   *
   *   bienvenida · identidad · modelo · proceso · dolor · gente · síntesis
   *
   * La escalera es deliberada y es la que Santiago pidió: la PRIMERA área abre
   * con una sola fase cerrada —bautizar al agente, dos preguntas— para que el
   * invitado toque producto de inmediato. Las demás piden lo que de verdad
   * necesitan para no estar vacías.
   */
  fasesQueNecesita: number;
  /** El título de la fase cuyo cierre la abre. Textual de H7 (`FICHAS`). */
  fraseDeLaFase: string;
  /**
   * `true` sólo si la sección de verdad sirve datos hoy.
   *
   * Es una constante y no una deducción, a propósito: no hay forma de saber en
   * tiempo de render si la pantalla de OTRO carril está cableada. Se verificó a
   * mano contra el árbol y aquí queda el resultado. `POR_QUE_NO_ABRE` dice, con
   * archivo y línea, qué hay que mover para ponerla en `true`.
   */
  construida: boolean;
}

/**
 * Qué le falta a cada sección para estar construida. No es documentación
 * suelta: es la lista de trabajo pendiente con archivo y línea, para que quien
 * la desbloquee sepa exactamente dónde tocar. Ninguno de esos archivos es de
 * H5, y por eso están escritos aquí y no arreglados.
 */
export const POR_QUE_NO_ABRE: Record<string, string> = {
  direccion:
    'apps/web/app/(app)/direccion/_lib/session.ts:119 — correoDeLaSesion() devuelve null. ' +
    'Con getServerSession(authOptions) el panel completo de la Bóveda empieza a servir datos. Es de H4.',
  operaciones:
    'apps/web/app/(app)/tareas/context.ts:28 — contextoDeTareas() devuelve null bajo un TODO(H2). ' +
    'El workspace de H9 está completo y hoy pinta "sin cablear". Es de H9. ' +
    '/automatizaciones sigue siendo el andamio de H1: su carril (H8) nunca empujó a main.',
  finanzas:
    'No existe ninguna ruta de Finanzas. El cobro es de H10 y los entitlements de H16; ' +
    'el área del negocio —margen, cobranza, impuestos— no la construye nadie todavía.',
};

// ════════════════════════════════════════════════════════════════════════════
// El catálogo
// ════════════════════════════════════════════════════════════════════════════

export const AREAS_DE_ARRANQUE: readonly AreaDeArranque[] = [
  {
    slug: 'ventas',
    label: 'Ventas',
    icon: 'target',
    position: 1,
    blurb: 'Cómo llega un cliente y cómo se cierra la venta.',
    tools: ['ventas:bandeja', 'ventas:contactos'],
    fasesQueNecesita: 1,
    fraseDeLaFase: 'El bautizo',
    construida: true,
  },
  {
    slug: 'direccion',
    label: 'Dirección',
    icon: 'compass',
    position: 2,
    blurb: 'Tu bóveda: los números, los documentos y la biblioteca del negocio.',
    tools: [
      'direccion:panel',
      'direccion:valores',
      'direccion:biblioteca',
      'direccion:ingesta',
      'direccion:mapa',
    ],
    fasesQueNecesita: 2,
    fraseDeLaFase: 'Tu negocio',
    construida: false,
  },
  {
    slug: 'finanzas',
    label: 'Finanzas',
    icon: 'wallet',
    position: 3,
    blurb: 'Qué entra, qué sale y cuánto queda.',
    tools: [],
    fasesQueNecesita: 3,
    fraseDeLaFase: 'Cómo ganas dinero',
    construida: false,
  },
  {
    slug: 'operaciones',
    label: 'Operaciones',
    icon: 'wrench',
    position: 4,
    blurb: 'Cómo se entrega lo que vendes.',
    tools: ['operaciones:tareas', 'operaciones:automatizaciones'],
    fasesQueNecesita: 4,
    fraseDeLaFase: 'Tu proceso',
    construida: false,
  },
];

// ════════════════════════════════════════════════════════════════════════════
// De catálogo a navegación
// ════════════════════════════════════════════════════════════════════════════

/**
 * Por qué está cerrada un área, o `null` si está abierta.
 *
 * El orden importa: primero se pregunta si está construida. Si no lo está, el
 * candado NO puede decir "sigue con tu Ritual", porque terminar el Ritual no la
 * abriría — y una promesa que no se cumple al cumplir el requisito es peor que
 * no haberla hecho.
 */
export function motivoDeCierre(
  area: AreaDeArranque,
  senales: SenalesDelRitual | null,
): MotivoDeCierre | null {
  if (!area.construida) return 'construccion';

  const cerradas = senales?.completado ? Number.POSITIVE_INFINITY : (senales?.faseIndice ?? 0);
  return cerradas >= area.fasesQueNecesita ? null : 'ritual';
}

/**
 * El catálogo convertido en lo que consume el sidebar.
 *
 * `access` va en `null` en todas las cerradas, no sólo el `state`: `isNavigable`
 * exige las dos cosas, así que ni un estado mal puesto puede abrir una puerta
 * que no debería.
 */
export function areasDeArranque(senales: SenalesDelRitual | null = null): AreaSummary[] {
  return AREAS_DE_ARRANQUE.map((a) => {
    const cerrada = motivoDeCierre(a, senales) !== null;
    return {
      slug: a.slug,
      label: a.label,
      icon: a.icon,
      position: a.position,
      state: cerrada ? 'bloqueada' : 'activa',
      access: cerrada ? null : 'admin',
      blurb: a.blurb,
      tools: cerrada ? [] : a.tools,
    } satisfies AreaSummary;
  });
}

/**
 * Qué falta para abrir cada área cerrada, en una frase que se lee.
 *
 * La del Ritual nombra al agente cuando se sabe cómo se llama: «se abre cuando
 * Chica Guapa termine contigo…» convierte un candado en una invitación, que es
 * exactamente el efecto que se busca.
 */
export function requisitosDeArranque(
  senales: SenalesDelRitual | null = null,
): Record<string, string> {
  const agente = senales?.agente?.trim();
  const quien = agente && agente.length > 0 ? agente : 'tu agente';
  const requisitos: Record<string, string> = {};

  for (const a of AREAS_DE_ARRANQUE) {
    const motivo = motivoDeCierre(a, senales);
    if (!motivo) continue;
    requisitos[a.slug] =
      motivo === 'ritual'
        ? `${quien} termine contigo «${a.fraseDeLaFase}» en tu Ritual de Fundación`
        : 'terminemos de construirla — es cosa nuestra, no tuya, y aquí te avisamos';
  }

  return requisitos;
}

// ════════════════════════════════════════════════════════════════════════════
// Las rutas
// ════════════════════════════════════════════════════════════════════════════

/**
 * Las rutas de las herramientas, **todas verificadas contra el árbol de
 * `apps/web/app`**. Ni una sola apunta a una carpeta que no existe, que era el
 * defecto del mock anterior.
 *
 * Se registran como RESPALDO: si el handoff dueño ya registró la suya, la suya
 * manda y no se pisa nada.
 */
export function registrarHerramientasDeArranque(): void {
  registerFallbackTools(
    // Ventas — las dos rutas existen y responden hoy.
    { key: 'ventas:bandeja', label: 'Bandeja', icon: 'inbox', href: '/bandeja', position: 0 },
    { key: 'ventas:contactos', label: 'Contactos', icon: 'contact', href: '/contactos', position: 1 },

    // Dirección — carpeta de H4, más el mapa de H11.
    { key: 'direccion:panel', label: 'Panel', icon: 'resumen', href: '/direccion', position: 0 },
    {
      key: 'direccion:valores',
      label: 'Valores',
      icon: 'gem',
      href: '/direccion/valores',
      position: 1,
    },
    {
      key: 'direccion:biblioteca',
      label: 'Biblioteca',
      icon: 'library',
      href: '/direccion/biblioteca',
      position: 2,
    },
    {
      key: 'direccion:ingesta',
      label: 'Agregar documento',
      icon: 'file',
      href: '/direccion/ingesta',
      position: 3,
    },
    { key: 'direccion:mapa', label: 'Mapa de negocio', icon: 'map', href: '/mapa', position: 4 },

    // Operaciones — carpetas de H9 y de H8.
    { key: 'operaciones:tareas', label: 'Tareas', icon: 'tasks', href: '/tareas', position: 0 },
    {
      key: 'operaciones:automatizaciones',
      label: 'Automatizaciones',
      icon: 'workflow',
      href: '/automatizaciones',
      position: 1,
    },
  );
}
