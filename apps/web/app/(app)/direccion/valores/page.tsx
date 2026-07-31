import {
  canEditVault,
  listarValores,
  loadTenantMeta,
  taxonomiaDe,
  type VaultRow,
} from '@abraxa/vault/api';
import { EstadoBoveda } from '../_components/estado-boveda';
import { contextoActual } from '../_lib/session';
import { TablaValores } from './tabla-valores';

export const dynamic = 'force-dynamic';

/**
 * El registro de valores canónicos.
 *
 * Porte de `GARDEN/garden-os/components/vault/tools/admin/valores.tsx` (427
 * líneas). Qué cambió al traerlo:
 *
 *   · Las áreas ya no están escritas en el componente: vienen del giro del
 *     tenant. Allá eran las 7 de Inperio, en una constante.
 *   · Se fueron los alcances `socio` y `propiedad`.
 *   · "Karen" —la bookkeeper de Inperio— pasó a ser "tus documentos".
 *   · La carga es server-side: los datos nunca salen del servidor sin contexto
 *     verificado, así que no hay header que falsificar.
 *
 * Qué se conservó, porque estaba bien:
 *   · El resaltado ámbar de los borradores.
 *   · El aviso de sólo lectura cuando no tienes acceso a Dirección.
 *   · Y sobre todo: el mensaje al aprobar dice QUÉ se propagó.
 */
export default async function PaginaValores({
  searchParams,
}: {
  searchParams?: { estado?: string; area?: string };
}) {
  let datos;
  try {
    const ctx = await contextoActual();
    const meta = await loadTenantMeta(ctx);
    const [valores, taxonomia] = await Promise.all([
      listarValores(ctx),
      taxonomiaDe(meta?.industryType),
    ]);
    datos = { valores, taxonomia, puedeEditar: canEditVault(ctx) };
  } catch (e) {
    return <EstadoBoveda error={e} />;
  }

  return (
    <TablaValores
      valores={datos.valores as VaultRow[]}
      areas={datos.taxonomia.areas.map((a) => ({ slug: a.slug, label: a.label }))}
      puedeEditar={datos.puedeEditar}
      filtroInicial={
        searchParams?.estado === 'borrador'
          ? 'borrador'
          : searchParams?.estado === 'conflicto'
            ? 'conflicto'
            : 'todos'
      }
      areaInicial={searchParams?.area ?? ''}
    />
  );
}
