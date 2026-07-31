/**
 * La implementación de `ContactsPort`.
 *
 * Es una fachada delgada a propósito: no tiene lógica propia, sólo compone las
 * cuatro piezas (contactos, fusión, embudo, línea de tiempo) en la superficie
 * que ven H6 y H8. Todo lo interesante está en los módulos de abajo, con sus
 * propias pruebas; esto sólo tiene que ser aburrido y correcto.
 */
import type { TenantContext } from '@abraxa/db';
import type {
  Contact,
  ContactEvent,
  ContactsPort,
  CreateContactInput,
  IdentityInput,
  ListContactsInput,
  ListContactsResult,
  Pipeline,
  RecordEventInput,
  ResolveInput,
  UpdateContactInput,
} from './port';
import {
  actualizarContacto,
  agregarEtiqueta,
  agregarIdentidad,
  asignarDueno,
  crearContacto,
  leerContacto,
  listarContactos,
  quitarEtiqueta,
  resolverPorIdentidad,
  tocar,
} from './contacts/service';
import { detectarDuplicados, fusionar } from './contacts/merge';
import { estadisticasEmbudo, listarEmbudos, moverEtapa, sembrarEmbudoPorDefecto } from './pipeline/service';
import { leerLinea, registrarEvento } from './timeline/service';

export function createCrmService(): ContactsPort {
  return {
    // ── H6 ────────────────────────────────────────────────────────────────
    resolveByIdentity: (ctx: TenantContext, i: ResolveInput) => resolverPorIdentidad(ctx, i),
    get: (ctx: TenantContext, contactId: string): Promise<Contact | null> =>
      leerContacto(ctx, contactId),
    recordEvent: (ctx: TenantContext, i: RecordEventInput) => registrarEvento(ctx, i),
    touch: (ctx: TenantContext, contactId: string, at?: string) => tocar(ctx, contactId, at),

    // ── H8 ────────────────────────────────────────────────────────────────
    moveStage: (ctx, i) => moverEtapa(ctx, i),
    assignOwner: (ctx, i) => asignarDueno(ctx, i),
    addTag: (ctx, i) => agregarEtiqueta(ctx, i),
    removeTag: (ctx, i) => quitarEtiqueta(ctx, i),

    // ── CRM ───────────────────────────────────────────────────────────────
    create: (ctx: TenantContext, i: CreateContactInput) => crearContacto(ctx, i),
    update: (ctx: TenantContext, contactId: string, i: UpdateContactInput) =>
      actualizarContacto(ctx, contactId, i),
    list: (ctx: TenantContext, i?: ListContactsInput): Promise<ListContactsResult> =>
      listarContactos(ctx, i ?? {}),
    addIdentity: (ctx: TenantContext, i: { contactId: string; identity: IdentityInput; actor?: string }) =>
      agregarIdentidad(ctx, i),
    merge: (ctx, i) => fusionar(ctx, i),
    findDuplicates: (ctx, i) => detectarDuplicados(ctx, i ?? {}),
    timeline: (ctx, i): Promise<ContactEvent[]> => leerLinea(ctx, i),

    // ── Embudo ────────────────────────────────────────────────────────────
    listPipelines: (ctx: TenantContext): Promise<Pipeline[]> => listarEmbudos(ctx),
    ensureDefaultPipeline: (ctx: TenantContext) => sembrarEmbudoPorDefecto(ctx),
    pipelineStats: (ctx, i) => estadisticasEmbudo(ctx, i ?? {}),
  };
}
