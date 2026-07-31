/**
 * Validación de un valor canónico.
 *
 * Es más estricta de lo que se ve, y a propósito: la clave se escribe en las
 * plantillas como `{valor.mi_clave}`, así que una clave con un espacio o un
 * acento produce un token que jamás va a resolver — y el síntoma aparece
 * semanas después, en un contrato, con un hueco donde iba el precio.
 * Mejor rechazarla al crearla.
 *
 * El regex es el mismo del CHECK de la migración 031. Si uno cambia, cambia el
 * otro: la base de datos es la última palabra, esto sólo da un mejor mensaje.
 */
import { z } from 'zod';
import { DOC_TYPES, VAULT_KINDS } from '../types';

export const CLAVE_RE = /^[a-z][a-z0-9_]*$/;

export const kindSchema = z.enum(VAULT_KINDS);
export const docTypeSchema = z.enum(DOC_TYPES);

export const claveSchema = z
  .string()
  .trim()
  .min(2, 'La clave necesita al menos 2 caracteres')
  .max(64, 'La clave no puede pasar de 64 caracteres')
  .regex(
    CLAVE_RE,
    'La clave va en snake_case: sólo minúsculas sin acentos, números y guion bajo, ' +
      'empezando por letra. Ej. comision_pct, ticket_promedio.',
  );

const scopeSchema = z.enum(['tenant', 'area']);

/**
 * `.strict()` a propósito: un campo con typo (`activo` en vez de `active`) se
 * ignoraría en silencio y el emprendedor creería que guardó algo que no guardó.
 */
export const crearValorSchema = z
  .object({
    key: claveSchema,
    label: z.string().trim().min(1, 'La etiqueta es obligatoria').max(160),
    kind: kindSchema,
    value: z.number().finite().nullable().optional(),
    value_text: z.string().max(4000).nullable().optional(),
    value_json: z.unknown().optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, 'La moneda va en código de 3 letras: MXN, USD…')
      .transform((s) => s.toUpperCase())
      .optional(),
    unit: z.string().trim().max(32).nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
    area_slug: z.string().trim().max(64).nullable().optional(),
    scope_type: scopeSchema.optional(),
    scope_id: z.string().trim().max(64).optional(),
    /** Se puede crear activo a mano. Lo que NUNCA nace activo es lo que
     *  extrae la ingesta: ese camino fuerza `false`. Ver ingest/pipeline.ts. */
    active: z.boolean().optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    source_doc_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scope_type === 'area' && !v.scope_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope_id'],
        message: 'Un valor con alcance por área necesita decir de qué área.',
      });
    }
    if ((v.scope_type ?? 'tenant') === 'tenant' && v.scope_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope_id'],
        message: 'Un valor general no lleva scope_id.',
      });
    }
    // Un valor de dinero sin monto es un valor que no dice nada. Se permite
    // (la ingesta crea claves "pendientes de definir"), pero no en un alta
    // manual: ahí el emprendedor sí sabe el número.
    if (
      (v.kind === 'money' || v.kind === 'percent' || v.kind === 'number') &&
      v.value == null &&
      !v.value_text
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `Un valor de tipo ${v.kind} necesita un número.`,
      });
    }
  });

export type CrearValorInput = z.infer<typeof crearValorSchema>;

/** El parche de edición: todo opcional menos que traiga algo. La clave NO se
 *  puede cambiar — renombrarla rompería las plantillas que ya la usan. */
export const editarValorSchema = crearValorSchema
  .innerType()
  .omit({ key: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar.');

export type EditarValorInput = z.infer<typeof editarValorSchema>;
