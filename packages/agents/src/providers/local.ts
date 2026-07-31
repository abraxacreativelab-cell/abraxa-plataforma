/**
 * Adaptador de modelos locales — v2.
 *
 * NO ESTÁ VACÍO POR DESCUIDO. Está aquí porque una interfaz con dos
 * implementaciones que se parecen no demuestra nada: las dos son APIs HTTP con
 * el mismo repertorio. El tercer caso —un modelo corriendo en la máquina, sin
 * llave, sin costo por token, probablemente sin tool use— es el que de verdad
 * pone a prueba si `ProviderAdapter` está bien trazada.
 *
 * Escribirlo ahora obligó a que la interfaz no asumiera:
 *   · que existe una `apiKey`             → aquí no hay
 *   · que el costo se mide en tokens      → aquí el costo marginal es cero
 *   · que hay un `requestId` que reconciliar → aquí no hay consola que cuadrar
 *
 * Las tres suposiciones estaban dentro de la interfaz en el primer borrador.
 *
 * Cuando existan modelos locales, migrar un agente es:
 *   UPDATE app.agent_definitions SET provider='local', model='...' WHERE ...
 *
 * Y `usage_ledger` seguirá registrando la corrida con costo 0 y
 * `cost_source='priced'` contra una fila de precio en ceros — porque el consumo
 * se mide aunque no se cobre. El día que se quiera saber cuánto se ahorró al
 * migrar, el dato va a estar.
 */
import { PlatformError } from '@abraxa/db';
import type { CompletionRequest, CompletionResponse, ProviderAdapter } from './types';

export function createLocalAdapter(): ProviderAdapter {
  return {
    name: 'local',

    complete(req: CompletionRequest): Promise<CompletionResponse> {
      return Promise.reject(
        new PlatformError(
          'PROVIDER_ERROR',
          `El proveedor 'local' todavía no tiene adaptador (está planeado para v2). ` +
            `El agente que pide '${req.model}' tiene provider='local' en app.agent_definitions: ` +
            `cámbialo a 'anthropic' u 'openrouter' mientras tanto.`,
          { retryable: false, details: { model: req.model } },
        ),
      );
    },
  };
}
