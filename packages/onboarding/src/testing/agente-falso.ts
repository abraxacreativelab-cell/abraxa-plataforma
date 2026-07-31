/**
 * Un `AgentPort` de mentiras, con guion.
 *
 * Regla 5 del contrato en su forma más útil: H7 consume `AgentPort` y no
 * `packages/agents`, así que probar el Ritual entero no necesita ni el motor de
 * H3, ni una llave de Anthropic, ni un token gastado.
 *
 * Guarda cada corrida —entrada, `systemSuffix` e historial— porque la mitad de
 * lo que hay que verificar no está en lo que el Ritual devuelve, sino en lo que
 * le MANDA al modelo: que el historial llegue completo después de reiniciar es
 * literalmente el criterio #2.
 */
import type { AgentPort, AgentRunInput, AgentRunResult, TenantContext } from '@abraxa/db';

export interface CorridaRegistrada {
  input: string;
  systemSuffix: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Una corrida detenida a media llamada al modelo.
 *
 * Es la única forma honesta de pararse DENTRO de la ventana que abre un turno:
 * entre que la petición escribió su fila y que termina de correr el modelo pasan
 * segundos reales, y ahí es donde caben las peticiones que este archivo tiene
 * que poder reproducir. Dormir no sirve —depende del planificador— y dos
 * procesos no caben en una prueba unitaria.
 */
export interface Barrera {
  /** Se resuelve cuando una corrida quedó detenida aquí. */
  readonly alcanzada: Promise<void>;
  /** Deja pasar a la corrida detenida. */
  liberar(): void;
}

export interface AgenteFalso extends AgentPort {
  /** Todo lo que se le mandó al modelo, en orden. */
  readonly corridas: CorridaRegistrada[];
  /** La última corrida. Falla si no hubo ninguna. */
  ultima(): CorridaRegistrada;
  /** Encola más respuestas. */
  guion(...respuestas: string[]): void;
  /** Definiciones creadas o actualizadas, para verificar el bautizo. */
  readonly definiciones: Array<{ role: string; name: string; systemPrompt: string }>;
  /**
   * Detiene la PRIMERA corrida cuya entrada cumpla el predicado.
   *
   * Sólo la primera: la barrera se desarma sola al dispararse, para que la
   * prueba pueda dejar correr las siguientes sin desmontarla.
   */
  detener(predicado: (input: string) => boolean): Barrera;
}

const USO_CERO = {
  inputTokens: 0,
  outputTokens: 0,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
  costUsd: 0,
};

export function crearAgenteFalso(...respuestas: string[]): AgenteFalso {
  const cola = [...respuestas];
  const corridas: CorridaRegistrada[] = [];
  const definiciones: Array<{ role: string; name: string; systemPrompt: string }> = [];
  let nombre = 'tu asistente';

  let barrera: { predicado: (input: string) => boolean; alcanzo: () => void; pase: Promise<void> } | null =
    null;

  const port: AgenteFalso = {
    corridas,
    definiciones,

    guion(...mas: string[]): void {
      cola.push(...mas);
    },

    ultima(): CorridaRegistrada {
      const u = corridas[corridas.length - 1];
      if (!u) throw new Error('El agente falso no ha corrido todavía.');
      return u;
    },

    detener(predicado: (input: string) => boolean): Barrera {
      let alcanzo!: () => void;
      let liberar!: () => void;
      const alcanzada = new Promise<void>((r) => (alcanzo = r));
      const pase = new Promise<void>((r) => (liberar = r));
      barrera = { predicado, alcanzo, pase };
      return { alcanzada, liberar };
    },

    async run(_ctx: TenantContext, i: AgentRunInput): Promise<AgentRunResult> {
      corridas.push({
        input: i.input,
        systemSuffix: i.systemSuffix ?? '',
        history: [...(i.history ?? [])],
      });

      // La barrera se lee y se desarma ANTES de esperar: si no, la corrida que
      // la prueba libera volvería a quedarse detenida en su propia barrera.
      if (barrera && barrera.predicado(i.input)) {
        const detenida = barrera;
        barrera = null;
        detenida.alcanzo();
        await detenida.pase;
      }

      const texto = cola.shift();
      if (texto === undefined) {
        throw new Error(
          `El agente falso se quedó sin guion en la corrida ${corridas.length}. ` +
            'Encola más respuestas con guion().',
        );
      }

      return {
        text: texto,
        usage: USO_CERO,
        stopReason: 'end_turn',
        agentName: nombre,
      };
    },

    registerTool(): void {
      /* el Ritual no registra tools */
    },

    upsertDefinition(_ctx, d): Promise<{ agentId: string }> {
      definiciones.push({ role: d.role, name: d.name, systemPrompt: d.systemPrompt });
      if (d.role === 'master') nombre = d.name;
      return Promise.resolve({ agentId: 'agente-falso' });
    },
  };

  return port;
}

/** Un `TenantContext` de pruebas. */
export function ctxDePrueba(tenantId = 'tenant-a'): TenantContext {
  return {
    tenantId,
    tenantSlug: tenantId,
    userEmail: 'dueno@ejemplo.mx',
    role: 'owner',
    areas: {},
  };
}
