/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Clasificación de un documento: área × tipo × título, y valores no numéricos.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Portado del prompt de GARDEN `abraxa-bookkeeper/ingest.ts:59-83`, con el
 *  cambio que pedía el handoff: allá el sistema empezaba con *"Eres Karen, la
 *  bookkeeper de Inperio (property management de renta vacacional)"*. Aquí el
 *  clasificador se describe por el GIRO DEL TENANT, leído de
 *  `app.industry_templates`. Un mismo prompt sirve a una taquería y a un
 *  despacho contable.
 *
 *  ── Por qué esto es una interfaz y no una llamada directa ───────────────────
 *
 *  H3 (agents) es dueño del router de proveedores, y su handoff dice
 *  explícitamente que no implemente tools de otros dominios. Pero `AgentPort`
 *  sólo acepta los roles master|sales|service|social|analyst, y ninguno es
 *  "clasificador de documentos". Reportado en el PR.
 *
 *  Mientras tanto: una interfaz estrecha con tres implementaciones. El día que
 *  H3 exponga un rol utilitario, se enchufa `desdeAgentPort()` y se borra el
 *  resto sin tocar el pipeline.
 *
 *  ── Y lo que de verdad importa ──────────────────────────────────────────────
 *
 *  ESTO ES OPCIONAL. Si no hay credenciales, `noopClassifier` devuelve valores
 *  por defecto y la ingesta SIGUE funcionando: el documento se guarda, se
 *  indexa, y los montos y porcentajes se extraen igual porque salen de un
 *  regex (`money.ts`). Un modelo caído degrada la clasificación, no la ingesta.
 */
import type { AgentPort, TenantContext } from '@abraxa/db';
import type { DocType, VaultKind } from '../types';
import { DOC_TYPES } from '../types';
import { normalizarClave } from './money';

export interface ClasificacionEntrada {
  content: string;
  /** Slugs válidos del giro del tenant. El modelo debe elegir uno de éstos. */
  areasValidas: string[];
  /** Cómo se describe el negocio. Sustituye al "Eres Karen de Inperio". */
  descripcionNegocio: string;
}

export interface ValorSugerido {
  key: string;
  kind: VaultKind;
  value: number | null;
  value_text: string | null;
  label: string;
  note: string | null;
}

export interface Clasificacion {
  areaSlug: string;
  docType: DocType;
  title: string;
  /** 0–1. Baja significa "revísalo tú". */
  confidence: number;
  valores: ValorSugerido[];
}

export interface DocClassifier {
  readonly nombre: string;
  clasificar(input: ClasificacionEntrada): Promise<Clasificacion | null>;
}

const TIPOS = DOC_TYPES.join(', ');

function construirPrompt(input: ClasificacionEntrada): string {
  return [
    `Clasificas documentos del negocio de un emprendedor. ${input.descripcionNegocio}`,
    '',
    `Elige UN área de esta lista exacta: ${input.areasValidas.join(', ')}.`,
    `Elige UN tipo de esta lista exacta: ${TIPOS}.`,
    '',
    'Extrae además los VALORES CANÓNICOS NO NUMÉRICOS que el documento declare:',
    'plazos (number), fechas (date), booleanos (bool), listas (list) y textos',
    'clave como horarios o políticas (text).',
    '',
    'NO extraigas montos ni porcentajes: ésos se sacan aparte de forma',
    'determinista y tu versión sólo introduciría errores.',
    '',
    'Usa claves en snake_case y en español, sin acentos.',
    'Ejemplos: dias_credito, horario_atencion, canales_activos.',
    '',
    'Responde SÓLO JSON válido con esta forma exacta:',
    '{"area":"...","doc_type":"...","title":"...","confidence":0.0,',
    ' "values":[{"key":"...","kind":"number|date|bool|list|text",',
    '            "value":null,"value_text":null,"label":"...","note":null}]}',
  ].join('\n');
}

/**
 * Tolerante con lo que devuelven los modelos: cercas de ```json, texto antes
 * del objeto, una coma de más al final. Fallar el parseo tiraría una ingesta
 * que por lo demás iba bien.
 */
export function parseJsonLaxo(texto: string): Record<string, unknown> | null {
  const limpio = String(texto ?? '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const ini = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  const trozo = ini >= 0 && fin > ini ? limpio.slice(ini, fin + 1) : limpio;
  try {
    const v = JSON.parse(trozo) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    try {
      return JSON.parse(trozo.replace(/,\s*([}\]])/g, '$1')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/**
 * Normaliza lo que dijo el modelo contra lo que la base acepta.
 * Un área inventada cae al primer slug válido; una clave mal formada se
 * descarta en vez de reventar el INSERT.
 */
export function normalizarClasificacion(
  crudo: Record<string, unknown>,
  areasValidas: string[],
): Clasificacion {
  const area = String(crudo.area ?? '');
  const tipo = String(crudo.doc_type ?? '');
  const respaldo = areasValidas.includes('direccion') ? 'direccion' : (areasValidas[0] ?? 'direccion');

  const valoresCrudos = Array.isArray(crudo.values) ? (crudo.values as unknown[]) : [];
  const valores: ValorSugerido[] = [];

  for (const v of valoresCrudos) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const key = normalizarClave(String(o.key ?? ''));
    if (!key || !/^[a-z][a-z0-9_]*$/.test(key)) continue;

    const kind = String(o.kind ?? 'text') as VaultKind;
    // Money y percent se ignoran a propósito aunque el modelo insista: ésos
    // los pone `money.ts` desde el texto, y un número inventado en la bóveda
    // es exactamente el fallo que todo esto existe para evitar.
    if (kind === 'money' || kind === 'percent') continue;
    if (!['number', 'text', 'date', 'bool', 'list'].includes(kind)) continue;

    const num = typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : null;
    valores.push({
      key,
      kind,
      value: num,
      value_text: o.value_text == null ? null : String(o.value_text),
      label: String(o.label ?? key.replace(/_/g, ' ')),
      note: o.note == null ? null : String(o.note),
    });
  }

  const conf = Number(crudo.confidence);

  return {
    areaSlug: areasValidas.includes(area) ? area : respaldo,
    docType: (DOC_TYPES as readonly string[]).includes(tipo) ? (tipo as DocType) : 'otro',
    title: String(crudo.title ?? '').trim().slice(0, 160) || 'Documento sin título',
    confidence: Number.isFinite(conf) ? Math.min(Math.max(conf, 0), 1) : 0.5,
    valores,
  };
}

/** Sin modelo. La ingesta sigue: el documento se guarda, indexa y parsea. */
export const noopClassifier: DocClassifier = {
  nombre: 'ninguno',
  async clasificar() {
    return null;
  },
};

/** Cuánto texto se le manda al modelo. Más allá, el costo sube y la señal no. */
const MAX_CARACTERES = 12_000;

/**
 * Anthropic por `fetch`.
 *
 * Sin SDK a propósito: es una petición, y el gate de propiedad no me deja
 * mover el lockfile para agregar una dependencia. `fetch` es global en Node 22.
 */
export function anthropicClassifier(opts: { apiKey?: string; model?: string } = {}): DocClassifier {
  const model = opts.model ?? process.env.INGEST_MODEL ?? 'claude-haiku-4-5-20251001';

  return {
    nombre: `anthropic:${model}`,
    async clasificar(input) {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return null;

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1500,
            temperature: 0,
            system: construirPrompt(input),
            messages: [{ role: 'user', content: input.content.slice(0, MAX_CARACTERES) }],
          }),
        });

        if (!res.ok) {
          console.warn(`[vault] clasificación HTTP ${res.status}; se ingiere sin clasificar`);
          return null;
        }

        const json = (await res.json()) as { content?: Array<{ text?: string }> };
        const texto = json.content?.map((c) => c.text ?? '').join('') ?? '';
        const crudo = parseJsonLaxo(texto);
        return crudo ? normalizarClasificacion(crudo, input.areasValidas) : null;
      } catch (e) {
        console.warn(`[vault] clasificación falló: ${(e as Error).message}`);
        return null;
      }
    },
  };
}

/**
 * Adaptador para cuando H3 exponga un rol utilitario.
 *
 * Hoy usa `analyst`, que es el rol de "no es tiempo real, piensa bien" — el
 * más cercano a clasificar un documento. Si H3 agrega un rol propio, aquí se
 * cambia una palabra.
 */
export function desdeAgentPort(port: AgentPort, ctx: TenantContext): DocClassifier {
  return {
    nombre: 'agent-port:analyst',
    async clasificar(input) {
      try {
        const r = await port.run(ctx, {
          role: 'analyst',
          input: input.content.slice(0, MAX_CARACTERES),
          systemSuffix: construirPrompt(input),
        });
        const crudo = parseJsonLaxo(r.text);
        return crudo ? normalizarClasificacion(crudo, input.areasValidas) : null;
      } catch (e) {
        console.warn(`[vault] clasificación vía AgentPort falló: ${(e as Error).message}`);
        return null;
      }
    },
  };
}

/** El que usa el pipeline si nadie inyecta otro. */
export function clasificadorPorDefecto(): DocClassifier {
  return process.env.ANTHROPIC_API_KEY ? anthropicClassifier() : noopClassifier;
}
