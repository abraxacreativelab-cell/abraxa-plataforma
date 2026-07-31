/**
 * El port vive en el registro CENTRAL de H1, no en uno paralelo.
 *
 * Es la prueba que sostiene la promesa del carril: H6 y H8 no esperan a que
 * este paquete mergee — registran un doble y siguen construyendo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError, __clearPorts, __setClientForTests, isPortReady, listPorts } from '@abraxa/db';
import { contextoDePrueba, createFakeDb } from './testing/fake-db';
import type { ContactsPort } from './port';
import {
  CONTACTS_PORT,
  __unregisterContactsPort,
  isContactsReady,
  registerContactsPort,
  tryContacts,
  useContacts,
} from './port-registration';
import { createCrmService } from './service';

let restaurar: () => void;

beforeEach(() => {
  __clearPorts();
  restaurar = __setClientForTests(createFakeDb().client);
});

afterEach(() => {
  restaurar();
  __clearPorts();
});

describe('registro del port', () => {
  it('sin registrar, useContacts dice a QUIÉN se está esperando', () => {
    expect(isContactsReady()).toBe(false);
    expect(tryContacts()).toBeNull();

    try {
      useContacts();
      throw new Error('debió lanzar');
    } catch (e) {
      expect(PlatformError.is(e)).toBe(true);
      if (PlatformError.is(e)) {
        expect(e.code).toBe('PORT_NOT_IMPLEMENTED');
        expect(e.status).toBe(501);
        // El mensaje de `usePort` diría "Lo entrega undefined" porque `OWNER`
        // de H1 no conoce esta llave. Por eso el error se compone aquí.
        expect(e.message).toContain('H15');
        expect(e.message).not.toContain('undefined');
      }
    }
  });

  it('registra en el MISMO registro central de H1', () => {
    registerContactsPort(createCrmService());
    // `isPortReady` es de `@abraxa/db`: si hubiera dos registros, esto sería
    // `false` y `/_health/packages` mentiría sobre el avance de las olas.
    expect(isPortReady(CONTACTS_PORT as never)).toBe(true);
    expect(isContactsReady()).toBe(true);
  });

  it('no ensucia los ocho ports que H1 sí conoce', () => {
    registerContactsPort(createCrmService());
    const nombres = listPorts().map((p) => p.port);
    expect(nombres).toHaveLength(8);
    expect(nombres).not.toContain('contacts');
    // `listPorts()` itera el mapa OWNER de H1, que no puede ampliarse desde
    // aquí sin romper su typecheck. Es la consecuencia conocida del atajo y
    // desaparece con el parche de docs/handoffs/H15-crm.md §9.
  });

  it('H6 y H8 pueden meter un doble y construir sin esperar a H15', async () => {
    const llamadas: string[] = [];
    const doble = {
      async resolveByIdentity() {
        llamadas.push('resolveByIdentity');
        return { contactId: 'falso', created: true };
      },
      async moveStage() {
        llamadas.push('moveStage');
        return { moved: true, stageId: 'etapa', previousStageId: null };
      },
    } as unknown as ContactsPort;

    registerContactsPort(doble);

    const ctx = contextoDePrueba('tenant-a');
    await useContacts().resolveByIdentity(ctx, { channel: 'whatsapp', identifier: '+521' });
    await useContacts().moveStage(ctx, { contactId: 'falso', stage: 'nuevo' });

    expect(llamadas).toEqual(['resolveByIdentity', 'moveStage']);
  });

  it('se puede desregistrar entre pruebas', () => {
    registerContactsPort(createCrmService());
    expect(isContactsReady()).toBe(true);
    __unregisterContactsPort();
    expect(isContactsReady()).toBe(false);
  });
});

describe('la superficie del port', () => {
  it('implementa las 16 operaciones del contrato', () => {
    const servicio = createCrmService();
    const esperadas: Array<keyof ContactsPort> = [
      'resolveByIdentity',
      'get',
      'recordEvent',
      'touch',
      'moveStage',
      'assignOwner',
      'addTag',
      'removeTag',
      'create',
      'update',
      'list',
      'addIdentity',
      'merge',
      'findDuplicates',
      'timeline',
      'listPipelines',
      'ensureDefaultPipeline',
      'pipelineStats',
    ];
    for (const m of esperadas) expect(typeof servicio[m]).toBe('function');
  });
});
