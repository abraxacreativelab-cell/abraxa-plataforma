/**
 * @abraxa/integrations — las credenciales de canal, por empresa y cifradas.
 *
 * ── Por qué existe este carril ─────────────────────────────────────────────
 *
 * Hasta hoy las credenciales de todos los canales son variables del proceso
 * (`.env.example:44-51`): una llave de Evolution, un secreto de app de Meta, un
 * número de Twilio, una llave de Resend. Una de cada cosa, para todos los
 * clientes a la vez.
 *
 * Eso funciona con un cliente. Con dos es un incidente, y no uno abstracto: dos
 * empresas dadas de alta hoy comparten instancia de Evolution y, en el peor
 * caso, el mismo número de WhatsApp. Al cliente de la panadería le llegan las
 * conversaciones de la clientela de la inmobiliaria.
 *
 * Este paquete convierte esas variables en filas por empresa, cifradas, con su
 * estado, su fecha de verificación y su dueño.
 *
 * ── Lo que hay que saber para usarlo ───────────────────────────────────────
 *
 *   1. `resolveFor(ctx, 'evolution')` devuelve la credencial de ESA empresa.
 *      La del tenant siempre gana; el respaldo de plataforma está apagado por
 *      defecto y es IMPOSIBLE para evolution, twilio y meta.
 *
 *   2. El secreto no sale por HTTP jamás. La API devuelve una huella.
 *
 *   3. "Conectado" significa comprobado contra el proveedor, no capturado. Y se
 *      vuelve a comprobar en un repaso periódico, porque los tokens caducan.
 *
 *   4. Para un webhook que no dice de quién es —Meta manda todas las páginas al
 *      mismo sitio— está `resolveTenantByExternalAccount()`. Devolver `null` es
 *      normal y significa "ignora y registra".
 *
 * ── Cómo se consume ────────────────────────────────────────────────────────
 *
 *     import { useIntegrations } from '@abraxa/integrations';
 *
 *     // H6 · el driver de WhatsApp, que YA acepta que se las pasen
 *     const cred = await useIntegrations().resolveFor(ctx, 'evolution');
 *     crearDriverEvolution({ baseUrl: String(cred.config.baseUrl), apiKey: cred.secret });
 *
 *     // H12 · el webhook de Meta
 *     const dueño = await useIntegrations().resolveTenantByExternalAccount({
 *       provider: 'meta', externalAccountId: entrada.entry[0].id,
 *     });
 *
 * `useIntegrations()` y no `usePort('integrations')` porque `PortRegistry` de
 * H1 no conoce esta llave todavía; el port SÍ vive en el registro central. El
 * porqué completo está en `src/port-registration.ts`.
 */
import { registerIntegrationsPort } from './port-registration';
import { createIntegrationsService } from './service';

export { router } from './routes';
export { meta } from './meta';

// ── La implementación del port ─────────────────────────────────────────────
export const integrationsService = createIntegrationsService();
registerIntegrationsPort(integrationsService);

// ── El contrato ────────────────────────────────────────────────────────────
export type {
  ExternalAccountRef,
  Integration,
  IntegrationEvent,
  IntegrationEventType,
  IntegrationSource,
  IntegrationStatus,
  IntegrationsPort,
  ListIntegrationsInput,
  ProviderInfo,
  ResolvedIntegration,
  SaveIntegrationInput,
  VerifyOutcome,
} from './port';

export {
  INTEGRATIONS_PORT,
  __unregisterIntegrationsPort,
  isIntegrationsReady,
  registerIntegrationsPort,
  tryIntegrations,
  useIntegrations,
} from './port-registration';

// ── Superficie pública del paquete ─────────────────────────────────────────
export { createIntegrationsService, type OpcionesServicio } from './service';

// El catálogo, para que una pantalla o un carril consumidor pueda leer la
// política de respaldo sin duplicarla.
export {
  PROVEEDORES,
  proveedor,
  respaldoEncendido,
  type CampoConfig,
  type ProveedorSpec,
  type ResultadoVerificacion,
} from './providers/catalogo';

// El cifrado, para el comando de rotación y para quien audite.
export { cerrar, abrir, hayLlave, huella, nombreDeLlave, versionActual, type Sobre } from './crypto/secret-box';

// El repaso periódico y la rotación.
export { COLA_DE_REPASO, repasar, type ResumenRepaso } from './sweep';
export { pendientesDeRotar, pendientesPorEmpresa, rotar, type ResumenRotacion } from './bin/rotate';

/**
 * El repaso periódico se registra desde AQUÍ, que es lo que pide
 * `apps/worker/src/index.ts` en su encabezado ("llama a registerQueue() desde
 * el index de tu paquete y no toques este archivo").
 *
 * No se puede importar `@abraxa/worker` desde un paquete —el worker depende de
 * los paquetes, no al revés—, así que la cola se expone como descriptor
 * (`COLA_DE_REPASO`) y el enganche de una línea en el worker queda anotado en
 * el PR, en la lista de §10 del handoff:
 *
 *     import { COLA_DE_REPASO } from '@abraxa/integrations';
 *     registerQueue(COLA_DE_REPASO);
 */
