/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Cómo le habla la bóveda a un cliente.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El ensayo del 2026-07-31 anotó cinco pantallas hablándole al invitado en
 *  jerga interna: nombres de carril («Falta: H2 · packages/tenancy»), rutas de
 *  paquete, números de migración. Este archivo es el sitio donde eso se
 *  traduce, y `sin-jerga.test.ts` es el que impide que vuelva.
 *
 *  La regla, en una frase: **si lo va a leer el dueño de un negocio, se escribe
 *  como se lo dirías a un amigo.** Lo demás —el nombre del carril, el error de
 *  Postgres, la variable de entorno que falta— va al log del servidor, que es
 *  donde de verdad sirve.
 *
 *  Y una segunda regla, que es la que hace que la primera se sostenga: los
 *  identificadores internos (`sop`, `value_text`, `money`) NO se pintan crudos
 *  aunque estén en español o parezcan inocentes. `sop` no significa nada para
 *  quien vende pasteles.
 */
import type { DocType, VaultKind } from './types';
import { KIND_LABEL } from './format';

// ════════════════════════════════════════════════════════════════════════════
// Vocabulario visible
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los 9 tipos de documento, dichos como los diría su dueño.
 *
 * `sop` es el caso que justifica la tabla entera: es "standard operating
 * procedure", se pintaba tal cual en una insignia junto al título del
 * documento, y no significa absolutamente nada para quien vende pasteles.
 */
export const ETIQUETA_DOC_TYPE: Record<DocType, string> = {
  sop: 'Cómo se hace',
  contrato: 'Contrato',
  precios: 'Precios',
  guion: 'Guion',
  politica: 'Política',
  manual: 'Manual',
  faq: 'Preguntas frecuentes',
  plantilla: 'Plantilla',
  otro: 'Otro',
};

/** La etiqueta de un tipo de documento, incluso si llega uno que no conocemos. */
export function etiquetaDocType(tipo: string | null | undefined): string {
  if (!tipo) return ETIQUETA_DOC_TYPE.otro;
  return ETIQUETA_DOC_TYPE[tipo as DocType] ?? ETIQUETA_DOC_TYPE.otro;
}

/** La etiqueta de un tipo de valor. `KIND_LABEL` ya la tenía bien; se reexpone
 *  desde aquí para que el vocabulario visible se lea en un solo archivo. */
export function etiquetaKind(kind: string | null | undefined): string {
  if (!kind) return 'Valor';
  return KIND_LABEL[kind as VaultKind] ?? 'Valor';
}

/**
 * Los campos del formulario, dichos en castellano.
 *
 * Los mensajes de validación salen de Zod con la RUTA del campo por delante
 * (`scope_id: …`, `value_text: …`). Esa ruta es el nombre de la columna, y el
 * cliente no tiene por qué conocerla.
 */
export const ETIQUETA_CAMPO: Record<string, string> = {
  key: 'la clave',
  label: 'el nombre',
  kind: 'el tipo',
  value: 'el número',
  value_text: 'el texto',
  value_json: 'la lista',
  currency: 'la moneda',
  unit: 'la unidad',
  note: 'la nota',
  area_slug: 'el área',
  scope_type: 'el alcance',
  scope_id: 'el área del alcance',
  active: 'el estado',
  position: 'el orden',
  source_doc_id: 'el documento de origen',
  title: 'el título',
  content: 'el contenido',
  doc_type: 'el tipo de documento',
  status: 'el estado',
};

export function etiquetaCampo(ruta: string): string {
  const limpia = ruta.trim();
  return ETIQUETA_CAMPO[limpia] ?? limpia.replace(/_/g, ' ');
}

// ════════════════════════════════════════════════════════════════════════════
// La búsqueda, cuando no puede buscar bien
// ════════════════════════════════════════════════════════════════════════════

/**
 * Qué decirle a alguien cuando la búsqueda por significado no corrió.
 *
 * Decirlo importa: sin este aviso, «no encontré nada» y «no pude buscar bien»
 * se ven idénticos, y el segundo hace que el cliente concluya que su documento
 * no está. Pero decirlo NO puede costar una lección de arquitectura: lo que se
 * pintaba antes en /direccion era, literalmente, `OPENAI_API_KEY ausente`.
 */
export const BUSQUEDA_SOLO_POR_PALABRAS =
  'Ahora mismo estoy buscando sólo por palabras exactas, no por significado. ' +
  'Si lo que buscas está dicho con otras palabras, puede que no aparezca.';

/** Lo mismo, en corto, para el aviso permanente del panel. */
export const SIGNIFICADO_EN_PAUSA =
  'La búsqueda por significado está en pausa. La búsqueda por palabras sigue ' +
  'funcionando y tus documentos se indexan solos en cuanto vuelva.';

// ════════════════════════════════════════════════════════════════════════════
// Errores
// ════════════════════════════════════════════════════════════════════════════

/** Lo que se enseña cuando el fallo es nuestro y no hay nada que la persona
 *  pueda hacer al respecto. El detalle real va al log. */
export const FALLO_NUESTRO = 'Algo falló de nuestro lado. Vuelve a intentarlo.';

/**
 * `true` si este código de error trae un mensaje escrito PARA el cliente.
 *
 * Los de validación, permiso, conflicto y "no existe" se redactan a mano y
 * dicen qué hacer. `INTERNAL` y los de proveedor arrastran el texto crudo de
 * Postgres o de una API ajena — «duplicate key value violates unique
 * constraint "canonical_values_identity_idx"»— y ése NUNCA se pinta.
 */
export function mensajeEsParaElCliente(code: string): boolean {
  return (
    code === 'VALIDATION' ||
    code === 'FORBIDDEN' ||
    code === 'NOT_FOUND' ||
    code === 'CONFLICT' ||
    code === 'UNAUTHENTICATED' ||
    code === 'BUDGET_EXCEEDED' ||
    code === 'RATE_LIMITED'
  );
}

// ════════════════════════════════════════════════════════════════════════════
// El guardián
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los patrones que no pueden aparecer en una cadena que el cliente vea.
 *
 * No es una lista de palabras feas: es la lista de las cosas concretas que el
 * invitado del ensayo leyó en pantalla, más las que están a un descuido de
 * aparecer. `sin-jerga.test.ts` la aplica sobre todo el carril.
 */
export const PATRONES_DE_JERGA: ReadonlyArray<{ nombre: string; re: RegExp }> = [
  { nombre: 'nombre de carril (H1…H18)', re: /\bH\d{1,2}\s*[·:.\-]/ },
  { nombre: 'ruta de paquete', re: /\bpackages\/[a-z-]+/ },
  { nombre: 'ruta de app', re: /\bapps\/(web|api|worker)\b/ },
  { nombre: 'número de migración', re: /\bmigraci[oó]n(?:es)?\s+\d{3}/i },
  { nombre: 'la palabra handoff', re: /\bhandoffs?\b/i },
  { nombre: 'la palabra port/puerto técnico', re: /\b(?:tryPort|usePort|registerPort)\b/ },
  { nombre: 'variable de entorno', re: /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/ },
  { nombre: 'identificador de columna', re: /\b(?:tenant_id|value_text|scope_id|doc_type|area_slug|source_doc_id)\b/ },
  { nombre: 'nombre de símbolo del código', re: /\b(?:TenancyPort|TenantContext|VaultRow|PlatformError|contextFor|getServerSession|authOptions)\b/ },
  { nombre: 'contrato de no colisión', re: /no colisi[oó]n|gate de propiedad/i },
];

/** Los nombres de jerga que trae un texto. Vacío = está limpio. */
export function jergaEn(texto: string): string[] {
  return PATRONES_DE_JERGA.filter(({ re }) => re.test(texto)).map(({ nombre }) => nombre);
}
