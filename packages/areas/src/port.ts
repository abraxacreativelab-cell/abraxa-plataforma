/**
 * `AreasPort` — lo único que los otros handoffs saben de H11.
 *
 * Son DOS funciones, y eso es todo lo que el contrato cruzado necesita: H5
 * pinta la navegación con `listAreas()` y H7 abre el área inicial del ritual con
 * `unlockArea()`. El mapa, el roadmap y el mini-onboarding NO están aquí —
 * viven en el router y en los servicios— porque son de la pantalla de H11, y
 * meterlos en el port haría que cada cambio interno de este carril fuera un
 * cambio en el contrato de otros dos.
 *
 * El aislamiento se aplica DENTRO: las dos reciben el `TenantContext` de quien
 * llama y leen por `tenantDb(ctx)`. El sidebar renderizado con el contexto del
 * cliente A no puede enseñar las áreas del B.
 */
import type { AreaSummary, AreasPort, TenantContext } from '@abraxa/db';
import type { AreaState } from './domain/types';
import { listAreas, unlockArea } from './services/areas';

export const areasPort: AreasPort = {
  listAreas(ctx: TenantContext): Promise<AreaSummary[]> {
    return listAreas(ctx);
  },

  unlockArea(ctx: TenantContext, areaSlug: string): Promise<{ state: AreaState }> {
    return unlockArea(ctx, areaSlug);
  },
};
