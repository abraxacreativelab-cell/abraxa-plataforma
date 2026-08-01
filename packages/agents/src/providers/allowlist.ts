/**
 * ════════════════════════════════════════════════════════════════════════════
 *  A QUÉ PROVEEDORES SE LES PUEDE MANDAR UNA CONVERSACIÓN DE UN CLIENTE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Esto no es una optimización ni una preferencia técnica: es una frontera de
 *  DATOS. El ledger de producción mostró corridas contra
 *  `openrouter/deepseek/deepseek-chat` y `openrouter/google/gemini-2.5-flash`
 *  que ningún `agent_definition` declara hoy.
 *
 *  ── Por dónde entraron ────────────────────────────────────────────────────
 *
 *  No hay fallback en el router (`providers/router.ts` sólo mapea proveedor →
 *  adaptador) ni default no-Anthropic en ningún lado (`DEFAULT_MODEL_BY_ROLE`
 *  de @abraxa/config son todos Claude, y `bin/measure-cache.ts` sólo prueba dos
 *  modelos de Anthropic). El único insumo de la selección es
 *  `agent_definitions.model` — y esa columna aceptaba CUALQUIER cadena: `model`
 *  es `text` libre en la migración 020, `upsertDefinicion` no lo validaba, y
 *  `tenantDb(ctx).from('agent_definitions').update(...)` es un camino de
 *  escritura documentado y disponible para cualquier paquete.
 *
 *  Así que una fila SÍ tuvo esos modelos, corrió, quedó en el ledger, y después
 *  se cambió. `usage_ledger` guarda la historia; `agent_definitions` sólo
 *  muestra el presente. Por eso H0 ve corridas sin definición que las explique.
 *
 *  Lo que convirtió "cualquier cadena" en "estas dos cadenas" son las filas
 *  semilla de la migración 021: son los ÚNICOS modelos no-Anthropic nombrados
 *  en todo el repositorio, y estar sembrados con precio los hace parecer
 *  soportados. Tanto, que este mismo paquete los citaba como razón para dejar
 *  pasar ids no-Anthropic en `dialectoValido()`. La migración 028 los borra.
 *
 *  ── Por qué la puerta va aquí y no en el adaptador ────────────────────────
 *
 *  Se aplica donde se ELIGE el modelo (`service.ts`, justo después de leer la
 *  fila), no donde se llama. La diferencia es lo que hace verdadera la promesa
 *  de la prueba: al fallar antes del paso 2, no se verifica presupuesto, no se
 *  resuelve llave, no se compone prompt, no se toca al proveedor y NO se
 *  escribe fila en `usage_ledger`. Un bloqueo en el adaptador ya habría armado
 *  el cuerpo con la conversación del cliente dentro.
 *
 *  ── Configurable, pero explícito ──────────────────────────────────────────
 *
 *  El default es Anthropic y nada más. Abrir otro proveedor es poner la
 *  variable de entorno a mano, que es exactamente el punto: que sea una
 *  decisión firmada y no un descuido. Y como aparece en la configuración del
 *  despliegue, queda en el mismo lugar donde se declara dónde se procesan los
 *  datos.
 */
import type { ProviderName } from '@abraxa/db';

/** Una regla `proveedor:patrón`. El patrón admite `*` sólo al final. */
export interface ReglaDeModelo {
  provider: ProviderName;
  /** `*` = cualquier modelo de ese proveedor. `anthropic/*` = ese prefijo. */
  patron: string;
}

/**
 * El default: SÓLO Anthropic.
 *
 *   anthropic:*            la Messages API de Anthropic. Procesa en EE. UU.
 *   openrouter:anthropic/* Anthropic a través de OpenRouter. El modelo de abajo
 *                          sigue siendo Claude; lo que cambia es el intermediario.
 *   local:*                el runtime propio de Santiago. No sale de su
 *                          infraestructura, así que no agrega ningún país a la
 *                          declaración — que es justo lo que esta lista
 *                          protege. (Todavía no hay adaptador: `local` falla más
 *                          adelante con su propio mensaje.)
 *
 * Lo que queda fuera y por qué importa: DeepSeek procesa en China y Google en
 * su propia huella. Mientras exista un camino de código que pueda mandarles una
 * conversación, esos países tendrían que ir en la declaración de tratamiento de
 * datos.
 */
export const PERMITIDOS_POR_DEFECTO = 'anthropic:*,openrouter:anthropic/*,local:*';

/**
 * Variable que abre la lista. Formato: `proveedor:patrón` separados por comas.
 *
 *   AGENTS_MODELOS_PERMITIDOS="anthropic:*,openrouter:anthropic/*,openrouter:google/*"
 *
 * Reemplaza al default por completo (no se suma): si la pones, la lista es
 * exactamente lo que dice. Es lo que hace que abrir un proveedor sea legible de
 * un vistazo en la configuración del despliegue, en vez de tener que cruzar un
 * default con un parche.
 */
export const VAR_ENTORNO = 'AGENTS_MODELOS_PERMITIDOS';

let cacheCrudo: string | null = null;
let cacheReglas: ReglaDeModelo[] = [];

const PROVEEDORES: readonly string[] = ['anthropic', 'openrouter', 'local'];

/** Parsea la lista. Una entrada mal escrita se ignora y NO abre nada. */
export function parsearReglas(crudo: string): ReglaDeModelo[] {
  const reglas: ReglaDeModelo[] = [];
  for (const bruto of crudo.split(',')) {
    const entrada = bruto.trim();
    if (entrada.length === 0) continue;

    const corte = entrada.indexOf(':');
    if (corte === -1) continue;

    const provider = entrada.slice(0, corte).trim();
    const patron = entrada.slice(corte + 1).trim();
    // Fallar hacia CERRADO: una entrada que no se entiende no concede permiso.
    // Lo contrario —interpretarla "de buena fe"— es cómo un typo en una
    // variable de entorno termina abriendo un proveedor que nadie autorizó.
    if (!PROVEEDORES.includes(provider) || patron.length === 0) continue;

    reglas.push({ provider: provider as ProviderName, patron });
  }
  return reglas;
}

/** Las reglas vigentes: las del entorno si están, si no el default. */
export function reglasVigentes(): ReglaDeModelo[] {
  const crudo = process.env[VAR_ENTORNO]?.trim() || PERMITIDOS_POR_DEFECTO;
  if (crudo !== cacheCrudo) {
    cacheCrudo = crudo;
    cacheReglas = parsearReglas(crudo);
  }
  return cacheReglas;
}

/** Para pruebas y para releer tras cambiar la variable en caliente. */
export function invalidarCacheReglas(): void {
  cacheCrudo = null;
  cacheReglas = [];
}

function coincide(patron: string, model: string): boolean {
  if (patron === '*') return true;
  if (patron.endsWith('*')) return model.startsWith(patron.slice(0, -1));
  return patron === model;
}

/** `true` si a ese proveedor se le puede mandar ese modelo. */
export function modeloPermitido(model: string, provider: ProviderName): boolean {
  const id = model.trim();
  if (id.length === 0) return false;
  return reglasVigentes().some((r) => r.provider === provider && coincide(r.patron, id));
}

/**
 * El mensaje del rechazo.
 *
 * Dice el par exacto, la lista vigente y CÓMO abrirla. Un error que sólo dice
 * "no permitido" manda a alguien a leer código; éste se resuelve en la consola
 * de despliegue — y de paso deja escrito, en el propio mensaje, que abrir un
 * proveedor es una decisión con consecuencias legales.
 */
export function razonDeBloqueo(model: string, provider: ProviderName): string {
  const vigentes = reglasVigentes()
    .map((r) => `${r.provider}:${r.patron}`)
    .join(', ');

  return (
    `El modelo '${model}' de '${provider}' no está en la lista de proveedores ` +
    `permitidos (${vigentes}). No se mandó ni un token. ` +
    `La lista existe para acotar EN QUÉ PAÍSES se procesan las conversaciones de ` +
    `los clientes: cada proveedor que se abre hay que declararlo. Si de verdad ` +
    `quieres habilitarlo, ponlo en la variable ${VAR_ENTORNO} del despliegue ` +
    `(formato 'proveedor:patrón', separados por comas) y actualiza la ` +
    `declaración de tratamiento de datos.`
  );
}
