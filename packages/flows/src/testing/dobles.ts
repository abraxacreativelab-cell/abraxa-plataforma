/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los dobles de los ports que este paquete consume.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La regla 5 del contrato existe para esto: se programa contra `InboxPort`,
 *  `ContactsPort`, `WorkPort` y `AgentPort`, y en las pruebas se registran
 *  dobles. Así los criterios #5 y #6 —que reintentar no duplique el mensaje, y
 *  que un canal caído pause y reanude— se verifican ENTEROS sin WhatsApp, sin
 *  credenciales de Evolution y sin base.
 *
 *  El doble de la bandeja no es un `vi.fn()` cualquiera: CUENTA los envíos por
 *  destinatario y puede fallar a voluntad, distinguiendo transitorio de
 *  permanente. Sin esas dos capacidades, «no se manda dos veces» no se puede
 *  afirmar — se puede suponer.
 */
import { registerPort } from '@abraxa/db';
import type {
  AgentPort,
  AgentRunResult,
  InboxPort,
  PortName,
  PortRegistry,
  TenancyPort,
  TenantContext,
  VaultPort,
  WorkPort,
} from '@abraxa/db';
import { PlatformError } from '@abraxa/db';
import type { Contact, ContactsPort, Pipeline } from '../crm';
import { LLAVE_CONTACTOS } from '../crm';

// ════════════════════════════════════════════════════════════════════════════
// Bandeja (H6)
// ════════════════════════════════════════════════════════════════════════════

export interface EnvioRegistrado {
  threadId: string;
  address: string;
  body: string;
}

export interface BandejaFalsa extends InboxPort {
  /** Todo lo que salió, en orden. */
  envios: EnvioRegistrado[];
  /** Cuántos mensajes le llegaron a esta dirección. */
  cuantosA(address: string): number;
  /**
   * Hace fallar el siguiente envío.
   * `'transitorio'` = 503 del proveedor → la corrida debe PAUSAR.
   * `'permanente'`  = número inválido   → la corrida debe MORIR.
   */
  fallarSiguiente(tipo: 'transitorio' | 'permanente'): void;
  /** Deja de fallar: es "el canal volvió". */
  sanar(): void;
}

export function bandejaFalsa(): BandejaFalsa {
  const envios: EnvioRegistrado[] = [];
  const hilos = new Map<string, string>(); // threadId → address
  let fallo: 'transitorio' | 'permanente' | null = null;
  let permanenteHastaSanar = false;

  return {
    envios,
    cuantosA: (address) => envios.filter((e) => e.address === address).length,
    fallarSiguiente(tipo) {
      fallo = tipo;
      permanenteHastaSanar = true;
    },
    sanar() {
      fallo = null;
      permanenteHastaSanar = false;
    },

    startThread(_ctx: TenantContext, i) {
      // Idempotente por dirección, como el de verdad (`asegurarHilo` de H6).
      const existente = [...hilos.entries()].find(([, dir]) => dir === i.address);
      if (existente) return Promise.resolve({ threadId: existente[0] });
      const threadId = `hilo-${hilos.size + 1}`;
      hilos.set(threadId, i.address);
      return Promise.resolve({ threadId });
    },

    send(_ctx: TenantContext, i) {
      if (fallo) {
        const tipo = fallo;
        if (!permanenteHastaSanar) fallo = null;
        return Promise.reject(
          tipo === 'transitorio'
            ? new PlatformError('CHANNEL_ERROR', 'el canal no está disponible (503)', {
                retryable: true,
              })
            : new PlatformError('CHANNEL_ERROR', 'ese número no existe', { retryable: false }),
        );
      }
      const address = hilos.get(i.threadId) ?? i.threadId;
      envios.push({ threadId: i.threadId, address, body: i.body });
      return Promise.resolve({ messageId: `msg-${envios.length}` });
    },

    setAiEnabled: () => Promise.resolve(),
    assign: () => Promise.resolve(),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CRM (H15)
// ════════════════════════════════════════════════════════════════════════════

export interface ContactoSemilla {
  id: string;
  displayName?: string;
  firstName?: string;
  ownerEmail?: string | null;
  whatsapp?: string;
  email?: string;
  tags?: string[];
  stage?: string;
}

export interface CrmFalso extends ContactsPort {
  etapas: string[];
  etiquetasDe(contactId: string): string[];
  responsableDe(contactId: string): string | null;
  eventos: Array<{ contactId: string; type: string; summary: string }>;
}

/** Un CRM en memoria con lo que este paquete de verdad le pide. */
export function crmFalso(semillas: ContactoSemilla[] = []): CrmFalso {
  const contactos = new Map<string, Contact>();
  const etiquetas = new Map<string, string[]>();
  const etapaDe = new Map<string, string>();
  const eventos: CrmFalso['eventos'] = [];
  const ETAPAS = ['nuevo', 'contactado', 'propuesta', 'ganado'];

  for (const s of semillas) {
    contactos.set(s.id, {
      id: s.id,
      displayName: s.displayName ?? 'Ana Pérez',
      firstName: s.firstName ?? 'Ana',
      lastName: null,
      companyName: null,
      ownerEmail: s.ownerEmail ?? null,
      lifecycle: 'lead',
      source: null,
      locale: null,
      custom: {},
      mergedInto: null,
      lastActivityAt: null,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      identities: [
        ...(s.whatsapp
          ? [
              {
                id: `${s.id}-wa`,
                channel: 'whatsapp' as const,
                identifier: s.whatsapp,
                raw: s.whatsapp,
                display: null,
                verified: true,
                isPrimary: true,
                createdAt: '2026-07-31T00:00:00.000Z',
              },
            ]
          : []),
        ...(s.email
          ? [
              {
                id: `${s.id}-mail`,
                channel: 'email' as const,
                identifier: s.email,
                raw: s.email,
                display: null,
                verified: true,
                isPrimary: true,
                createdAt: '2026-07-31T00:00:00.000Z',
              },
            ]
          : []),
      ],
      tags: s.tags ?? [],
      placements: [],
    });
    etiquetas.set(s.id, [...(s.tags ?? [])]);
    if (s.stage) etapaDe.set(s.id, s.stage);
  }

  const embudo: Pipeline = {
    id: 'emb-1',
    slug: 'ventas',
    name: 'Ventas',
    isDefault: true,
    position: 0,
    stages: ETAPAS.map((slug, i) => ({
      id: `etapa-${i + 1}`,
      slug,
      name: slug,
      position: i,
      probability: i * 25,
      isWon: slug === 'ganado',
      isLost: false,
    })),
  };

  const noImplementado = (): never => {
    throw new PlatformError('INTERNAL', 'el doble del CRM no implementa eso');
  };

  return {
    etapas: ETAPAS,
    etiquetasDe: (id) => etiquetas.get(id) ?? [],
    responsableDe: (id) => contactos.get(id)?.ownerEmail ?? null,
    eventos,

    get: (_ctx, id) => Promise.resolve(contactos.get(id) ?? null),

    moveStage: (_ctx, i) => {
      const etapa = embudo.stages.find((s) => s.slug === i.stage || s.id === i.stage);
      if (!etapa) throw new PlatformError('NOT_FOUND', `no existe la etapa ${i.stage}`);
      const anterior = etapaDe.get(i.contactId) ?? null;
      const movido = anterior !== etapa.slug;
      if (movido) etapaDe.set(i.contactId, etapa.slug);
      return Promise.resolve({
        moved: movido,
        stageId: etapa.id,
        previousStageId: anterior,
      });
    },

    addTag: (_ctx, i) => {
      const actuales = etiquetas.get(i.contactId) ?? [];
      if (actuales.includes(i.tag)) return Promise.resolve({ added: false });
      etiquetas.set(i.contactId, [...actuales, i.tag]);
      return Promise.resolve({ added: true });
    },

    removeTag: (_ctx, i) => {
      const actuales = etiquetas.get(i.contactId) ?? [];
      etiquetas.set(i.contactId, actuales.filter((t) => t !== i.tag));
      return Promise.resolve({ removed: actuales.includes(i.tag) });
    },

    assignOwner: (_ctx, i) => {
      const c = contactos.get(i.contactId);
      if (c) contactos.set(i.contactId, { ...c, ownerEmail: i.ownerEmail });
      return Promise.resolve();
    },

    recordEvent: (_ctx, i) => {
      eventos.push({ contactId: i.contactId, type: String(i.type), summary: i.summary });
      return Promise.resolve({ eventId: `ev-${eventos.length}` });
    },

    listPipelines: () => Promise.resolve([embudo]),

    touch: () => Promise.resolve(),
    create: noImplementado,
    update: noImplementado,
    list: noImplementado,
    addIdentity: noImplementado,
    merge: noImplementado,
    findDuplicates: noImplementado,
    timeline: noImplementado,
    resolveByIdentity: noImplementado,
    ensureDefaultPipeline: noImplementado,
    pipelineStats: noImplementado,
  } as CrmFalso;
}

// ════════════════════════════════════════════════════════════════════════════
// Tareas (H9), agentes (H3), bóveda (H4) y tenancy (H2)
// ════════════════════════════════════════════════════════════════════════════

export interface TareasFalsas extends WorkPort {
  creadas: Array<{ title: string; assignedTo?: string }>;
}

export function tareasFalsas(): TareasFalsas {
  const creadas: TareasFalsas['creadas'] = [];
  return {
    creadas,
    createTask: (_ctx, i) => {
      creadas.push({ title: i.title, ...(i.assignedTo ? { assignedTo: i.assignedTo } : {}) });
      return Promise.resolve({ taskId: `tarea-${creadas.length}` });
    },
  };
}

export function agentesFalsos(respuesta: string | (() => string) = 'listo'): AgentPort {
  return {
    run: (): Promise<AgentRunResult> =>
      Promise.resolve({
        text: typeof respuesta === 'function' ? respuesta() : respuesta,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.0001,
        },
        stopReason: 'end_turn',
        agentName: 'Karen',
      }),
    registerTool: () => undefined,
    upsertDefinition: () => Promise.resolve({ agentId: 'ag-1' }),
  };
}

export function bovedaFalsa(valores: Record<string, string> = {}): VaultPort {
  return {
    resolve: () => Promise.resolve(valores),
    injectIntoPrompt: (_ctx, prompt) => Promise.resolve(prompt),
    render: (_ctx, plantilla) => Promise.resolve(plantilla),
    ingestDocument: () => Promise.resolve({ documentId: 'doc-1', valueIds: [] }),
    detectGaps: () => Promise.resolve([]),
  };
}

export function tenancyFalso(correos: string[] = []): TenancyPort {
  return {
    provision: () => Promise.resolve({ tenantId: 't-1', created: false }),
    contextFor: () => Promise.reject(new PlatformError('FORBIDDEN', 'el doble no resuelve sesiones')),
    canSignIn: () => Promise.resolve(false),
    primaryTenantSlugFor: () => Promise.resolve(null),
    listMembers: () =>
      Promise.resolve(correos.map((email) => ({ email, name: null, role: 'member' as const }))),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Registro
// ════════════════════════════════════════════════════════════════════════════

/** Registra el doble del CRM bajo la misma llave que usa H15. */
export function registrarCrm(doble: ContactsPort): void {
  registerPort(LLAVE_CONTACTOS, doble as unknown as PortRegistry[PortName]);
}

export interface DoblesRegistrados {
  bandeja: BandejaFalsa;
  crm: CrmFalso;
  tareas: TareasFalsas;
}

/** Registra de un tirón todo lo que el motor consume. */
export function registrarTodo(
  i: {
    contactos?: ContactoSemilla[];
    valores?: Record<string, string>;
    equipo?: string[];
    respuestaDelAgente?: string | (() => string);
  } = {},
): DoblesRegistrados {
  const bandeja = bandejaFalsa();
  const crm = crmFalso(i.contactos ?? []);
  const tareas = tareasFalsas();

  registerPort('inbox', bandeja);
  registerPort('work', tareas);
  registerPort('agents', agentesFalsos(i.respuestaDelAgente ?? 'listo'));
  registerPort('vault', bovedaFalsa(i.valores ?? {}));
  registerPort('tenancy', tenancyFalso(i.equipo ?? []));
  registrarCrm(crm);

  return { bandeja, crm, tareas };
}
