/**
 * @abraxa/onboarding — El Ritual de Fundacion: entrevista reanudable y Mapa de Negocio
 *
 * Carril de H7. H1 dejó el paquete creado, cableado a apps/api y con sus
 * dependencias instaladas: no hay que editar nada fuera de esta carpeta.
 *
 * Al construir:
 *   1. Cuelga tus rutas de este `router`. apps/api ya lo monta en /onboarding.
 *   2. Si implementas un port, regístralo aquí abajo con `registerPort()`.
 *   3. Pon `ready: true` en src/meta.ts cuando el paquete haga algo real.
 *   4. Todo dato de dominio pasa por `tenantDb(ctx)`. El cliente crudo está
 *      prohibido por ESLint y no es negociable.
 */
import { Router } from 'express';

export const router: Router = Router();

export { meta } from './meta';
