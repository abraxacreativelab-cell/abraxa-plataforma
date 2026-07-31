/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El catálogo de áreas — des-inperiado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Lo que se corrige de GARDEN, punto 1 del handoff §4: `INPERIO_AREAS` está
 *  clavado a las 8 áreas de una inmobiliaria (karen/src/types.ts:86-95), y el
 *  prompt de la entrevistadora se autodescribe como "bookkeeper de Inperio
 *  (property management)" (ingest.ts:59). Aquí no hay una sola palabra de
 *  bienes raíces: las seis áreas son las de CUALQUIER negocio que vende algo.
 *
 *  ── Por qué las reglas viven en datos y son deterministas ─────────────────
 *
 *  El criterio #4 dice que dos emprendedores de giros distintos tienen que
 *  obtener MAPAS DISTINTOS. Si eso dependiera sólo de lo que el modelo decida
 *  en la fase 6, sería imposible de verificar sin gastar tokens y sin flaky
 *  tests — y en la práctica un modelo cansado devuelve la misma plantilla.
 *
 *  Así que el piso es determinista: cada área tiene una regla que lee los datos
 *  del negocio y decide con qué estado nace. Encima de eso, lo que el agente
 *  haya propuesto explícitamente durante la entrevista (`[AREA:…]`) MANDA — él
 *  habló con la persona y nosotros no. El determinismo es el piso, no el techo.
 *
 *  Los `slug` son los mismos que conoce el design system de H5
 *  (packages/ui/src/lib/accent.ts): así cada área trae su acento sin que nadie
 *  tenga que cablear nada. Los requisitos usan el vocabulario que pide H11 §5
 *  —condiciones evaluables, no código— para que él los pueda ajustar por giro
 *  sin desplegar.
 */
import type { AreaState } from '@abraxa/db';
import type { EstadoNegocio, RequisitoDeArea } from '../types';

export interface AreaDelCatalogo {
  slug: string;
  label: string;
  /** La promesa. Se le muestra INCLUSO si el área está bloqueada (H11 §5). */
  blurb: string;
  position: number;
  requisitos: RequisitoDeArea[];
  /**
   * Con qué estado nace para ESTE negocio, y por qué.
   *
   * La razón se redacta con los datos que dio el emprendedor, no con
   * generalidades: "vendes por WhatsApp y ya tienes un recorrido de 4 pasos"
   * pesa distinto que "es importante tener ventas".
   */
  decidir(e: EstadoNegocio): { estado: AreaState; razon: string };
}

// ── Ayudas de lectura del estado ────────────────────────────────────────────

const tiene = (v: string | undefined): boolean => typeof v === 'string' && v.trim().length > 0;

const listado = (xs: string[] | undefined): string => (xs ?? []).join(', ');

/** ¿El negocio ya opera de verdad, o apenas va empezando? */
function operando(e: EstadoNegocio): boolean {
  const etapa = (e.etapa ?? '').toLowerCase();
  return /oper|crec|estable|madur|escal/.test(etapa);
}

function esIdea(e: EstadoNegocio): boolean {
  const etapa = (e.etapa ?? '').toLowerCase();
  return /idea|arranc|empez|valid|pre-?lanz/.test(etapa);
}

/** ¿Va a haber más gente, hoy o pronto? */
function conGente(e: EstadoNegocio): boolean {
  const eq = (e.equipo ?? '').toLowerCase();
  return /equipo|socio|emplead|contrat|asistent|becari/.test(eq);
}

/** Un paso del recorrido que ocurre DESPUÉS de cobrar. */
function tienePosventa(e: EstadoNegocio): boolean {
  const patron = /entreg|instal|onboard|arranqu|bienven|capacit|implement|activa|alta/i;
  return (e.recorrido ?? []).some((p) => patron.test(p.nombre) || patron.test(p.como ?? ''));
}

/** Dolores que hablan de no alcanzar a contestar. */
function dolorDeAtencion(e: EstadoNegocio): boolean {
  const patron = /contest|respond|segui|tarde|perd|olvid|mensaj|whats|llamad|atenc|queja|reclam/i;
  return (e.dolores ?? []).some((d) => patron.test(d.texto));
}

/** Dolores sobre dinero, cobranza o no saber si gana. */
function dolorDeDinero(e: EstadoNegocio): boolean {
  const patron = /cobr|factur|pag|cuenta|numer|númer|gast|cost|margen|dinero|flujo|utilidad/i;
  return (e.dolores ?? []).some((d) => patron.test(d.texto));
}

// ════════════════════════════════════════════════════════════════════════════
// Las seis áreas
// ════════════════════════════════════════════════════════════════════════════

export const CATALOGO: readonly AreaDelCatalogo[] = [
  {
    slug: 'ventas',
    label: 'Ventas y marketing',
    blurb: 'Un equipo de ventas que nunca duerme.',
    position: 1,
    requisitos: [
      { type: 'has_channel', min: 1, label: 'conectar al menos un canal por donde te escriben' },
      { type: 'has_pipeline', label: 'definir las etapas por las que pasa un cliente' },
    ],
    // Ventas nunca nace bloqueada. Un negocio que no vende no es un negocio, y
    // arrancar con TODO cerrado es la forma más rápida de que alguien cierre la
    // pestaña. Lo que cambia según el negocio es si nace disponible o ya en
    // progreso.
    //
    // `en_progreso` exige las tres: que ya opere, que tenga canales y que su
    // recorrido esté descrito. Las tres juntas significan una cosa concreta —
    // aquí no hay que EMPEZAR ventas, hay que ORDENAR las que ya existen— y es
    // una distinción que el emprendedor siente al leerla.
    decidir(e) {
      const canales = e.canales ?? [];
      const pasos = (e.recorrido ?? []).length;
      if (operando(e) && canales.length > 0 && pasos >= 3) {
        return {
          estado: 'en_progreso',
          razon: `Ya operas, te llegan clientes por ${listado(canales)} y me describiste un recorrido de ${pasos} pasos: aquí hay un embudo real que ordenar, no uno que inventar.`,
        };
      }
      if (canales.length > 0) {
        return {
          estado: 'disponible',
          razon: `Te escriben por ${listado(canales)}. Lo primero es que nada de eso se pierda.`,
        };
      }
      return {
        estado: 'disponible',
        razon: 'Es por donde entra el dinero. Empieza aquí aunque no tengas nada conectado todavía.',
      };
    },
  },

  {
    slug: 'servicio',
    label: 'Servicio y atención',
    blurb: 'Dejar de perder clientes por no contestar.',
    position: 2,
    requisitos: [
      { type: 'contact_count', min: 5, label: 'tener 5 contactos activos en el sistema' },
    ],
    decidir(e) {
      if (dolorDeAtencion(e)) {
        const cual = (e.dolores ?? []).find((d) =>
          /contest|respond|segui|tarde|perd|mensaj|whats/i.test(d.texto),
        );
        return {
          estado: 'disponible',
          razon: `Me dijiste esto: "${cual?.texto ?? 'se te acumulan los mensajes'}". Eso no se arregla con más ganas, se arregla aquí.`,
        };
      }
      if ((e.canales ?? []).length > 0) {
        return {
          estado: 'disponible',
          razon: `Contestas por ${listado(e.canales)}. En cuanto el volumen suba, éste es el primero que truena.`,
        };
      }
      return {
        estado: 'bloqueada',
        razon: 'Se abre sola cuando tengas conversaciones vivas que atender.',
      };
    },
  },

  {
    slug: 'direccion',
    label: 'Dirección',
    blurb: 'Tus números en un solo lugar, para que nada más mienta.',
    position: 3,
    requisitos: [
      { type: 'value_count', min: 3, label: 'definir 3 valores canónicos del negocio' },
      { type: 'document_count', min: 1, label: 'o cargar un documento tuyo' },
    ],
    // Dirección es la bóveda: precios, políticas, el documento madre. Si el
    // emprendedor ya dijo cuánto cobra y qué margen le queda, ya hay qué
    // guardar — el Ritual mismo se lo va a mandar.
    decidir(e) {
      if (tiene(e.ticket) && tiene(e.margen)) {
        return {
          estado: 'disponible',
          razon: `Ya me diste tu ticket (${e.ticket}) y tu margen (${e.margen}). Esos números tienen que vivir en un solo lugar antes de que alguien los repita mal.`,
        };
      }
      if (tiene(e.ticket) || tiene(e.modeloIngreso)) {
        return {
          estado: 'disponible',
          razon: 'Ya tienes con qué empezar tu bóveda: lo que cobras y cómo lo cobras.',
        };
      }
      return {
        estado: 'bloqueada',
        razon: 'Se abre cuando tengas al menos tres datos duros del negocio que valga la pena fijar.',
      };
    },
  },

  {
    slug: 'onboarding',
    label: 'Onboarding de clientes',
    blurb: 'Cómo se siente entrar a tu negocio siendo cliente.',
    position: 4,
    requisitos: [
      { type: 'first_sale', label: 'cerrar tu primera venta dentro del sistema' },
    ],
    decidir(e) {
      if (tienePosventa(e)) {
        const paso = (e.recorrido ?? []).find((p) =>
          /entreg|instal|onboard|arranqu|bienven|capacit|implement|activa|alta/i.test(p.nombre),
        );
        return {
          estado: 'disponible',
          razon: `Tu proceso ya tiene un "${paso?.nombre ?? 'después de la venta'}". Eso es un onboarding, aunque todavía no se llame así.`,
        };
      }
      return {
        estado: 'bloqueada',
        razon: 'Se abre con tu primera venta cerrada aquí adentro. Antes de eso no hay a quién recibir.',
      };
    },
  },

  {
    slug: 'rh',
    label: 'Equipo',
    blurb: 'Graduarte de solopreneur.',
    position: 5,
    requisitos: [
      { type: 'declares_hiring', label: 'decir que vas a sumar a alguien' },
    ],
    decidir(e) {
      if (conGente(e)) {
        return {
          estado: 'disponible',
          razon: `Me dijiste "${e.equipo}". En cuanto entra alguien más, lo que tienes en la cabeza deja de servir: tiene que estar escrito.`,
        };
      }
      return {
        estado: 'bloqueada',
        razon: 'Hoy estás tú. Esta área te espera el día que vayas a sumar a alguien — y ese día te va a urgir.',
      };
    },
  },

  {
    slug: 'finanzas',
    label: 'Finanzas',
    blurb: 'Saber si de verdad ganas.',
    position: 6,
    requisitos: [
      { type: 'months_operating', min: 3, label: 'tener 3 meses de operación registrada' },
    ],
    decidir(e) {
      if (operando(e) && dolorDeDinero(e)) {
        return {
          estado: 'disponible',
          razon: 'Ya operas y uno de tus dolores es de dinero. No hay que esperar tres meses para eso.',
        };
      }
      if (operando(e)) {
        return {
          estado: 'bloqueada',
          razon: 'Ya operas, así que esto se abre pronto: en cuanto haya tres meses registrados aquí adentro.',
        };
      }
      if (esIdea(e)) {
        return {
          estado: 'bloqueada',
          razon: 'Todavía no hay historia que analizar. Primero vende; los números vienen después.',
        };
      }
      return {
        estado: 'bloqueada',
        razon: 'Se abre con tres meses de operación registrada.',
      };
    },
  },
] as const;

export function areaDelCatalogo(slug: string): AreaDelCatalogo | undefined {
  return CATALOGO.find((a) => a.slug === slug);
}
