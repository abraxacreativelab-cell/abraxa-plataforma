import { loadTenantMeta, taxonomiaDe } from '@abraxa/vault/api';
import { EstadoBoveda } from '../_components/estado-boveda';
import { contextoActual } from '../_lib/session';
import { PantallaIngesta } from './pantalla-ingesta';

export const dynamic = 'force-dynamic';

export default async function PaginaIngesta() {
  let areas;
  try {
    const ctx = await contextoActual();
    const meta = await loadTenantMeta(ctx);
    const taxonomia = await taxonomiaDe(meta?.industryType);
    areas = taxonomia.areas.map((a) => ({ slug: a.slug, label: a.label }));
  } catch (e) {
    return <EstadoBoveda error={e} />;
  }

  return <PantallaIngesta areas={areas} />;
}
