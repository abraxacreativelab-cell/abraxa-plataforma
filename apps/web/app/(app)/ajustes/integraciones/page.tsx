import type { Metadata } from 'next';
import { LoadError } from '@abraxa/ui';
import { cargarBitacora, cargarIntegraciones, cargarProveedores } from './datos';
import { Aviso, RespaldoDePlataforma, SinCablear } from './estados';
import { Formulario, Tarjeta } from './lista';

export const metadata: Metadata = { title: 'Integraciones · ABRAXA Plataforma' };

/**
 * `/ajustes/integraciones` — las llaves de los canales de ESTA empresa.
 *
 * Componente de SERVIDOR, y sin una línea de JavaScript de cliente: lo que se
 * escribe aquí son credenciales, y no tienen por qué pasar por el estado de un
 * componente del navegador. Los formularios llaman a las acciones de servidor
 * de `acciones.ts` directamente.
 *
 * Lo que esta pantalla promete, y cumple:
 *
 *   · Nunca enseña un secreto. Enseña una HUELLA, que sirve para saber si la
 *     que está puesta es la que acabas de pegar.
 *   · Distingue capturado de conectado. Una credencial que el proveedor no
 *     aceptó se ve distinta de una que sí, y el motivo va arriba.
 *   · Si se está usando el respaldo de la plataforma, lo dice. Un respaldo
 *     silencioso es cómo se llega a dos clientes compartiendo una cuenta sin
 *     que nadie lo haya decidido.
 */
/** Un parámetro de la URL, ya normalizado: repetido, se toma el primero. */
function uno(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const aviso = uno(searchParams?.aviso);
  const detalle = uno(searchParams?.detalle);

  const [integraciones, proveedores, bitacora] = await Promise.all([
    cargarIntegraciones(),
    cargarProveedores(),
    cargarBitacora(),
  ]);

  const conectadas = integraciones.estado === 'datos' ? integraciones.datos : [];
  const catalogo = proveedores.estado === 'datos' ? proveedores.datos : [];

  // Un proveedor con respaldo ENCENDIDO y sin credencial propia conectada: es
  // exactamente el caso que hay que decir en voz alta.
  const conRespaldo = catalogo.filter(
    (p) => p.fallbackActive && !conectadas.some((i) => i.provider === p.name && i.status === 'connected'),
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Ajustes</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Integraciones</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Las llaves de tus canales — tu WhatsApp, tu Instagram, tu correo, tus SMS. Son{' '}
          <strong className="text-foreground">tuyas</strong>: se guardan cifradas, sólo tu empresa
          las usa, y nadie —ni nosotros— puede volver a leerlas desde aquí.
        </p>
      </header>

      <div className="space-y-8">
        {aviso && <Aviso tipo={aviso} detalle={detalle} />}

        {conRespaldo.map((p) => (
          <RespaldoDePlataforma key={p.name} label={p.label} />
        ))}

        {integraciones.estado === 'error' && <LoadError failure={integraciones.falla} />}
        {integraciones.estado === 'sin-cablear' && <SinCablear motivo={integraciones.motivo} />}

        {integraciones.estado === 'datos' && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Lo que ya conectaste</h2>
            {conectadas.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-card/20 px-4 py-6 text-sm text-muted-foreground">
                Todavía nada. Conecta tu primer canal abajo: en cuanto lo hagas, tus agentes
                contestan por él.
              </p>
            ) : (
              <div className="space-y-3">
                {conectadas.map((i) => (
                  <Tarjeta key={i.id} integracion={i} />
                ))}
              </div>
            )}
          </section>
        )}

        {catalogo.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Conectar un canal</h2>
            <div className="space-y-3">
              {catalogo.map((p) => (
                <Formulario key={p.name} proveedor={p} />
              ))}
            </div>
          </section>
        )}

        {bitacora.estado === 'datos' && bitacora.datos.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Lo que ha pasado
            </h2>
            <p className="mb-3 max-w-2xl text-xs text-muted-foreground/70">
              Cuándo se conectó, cuándo se comprobó y cuándo dejó de funcionar. Es lo que contesta
              &ldquo;conecté mi WhatsApp y no me llegó nada&rdquo;.
            </p>
            <ol className="space-y-2">
              {bitacora.datos.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border bg-card/20 px-4 py-2 text-xs"
                >
                  <span className="font-mono uppercase tracking-widest text-muted-foreground">
                    {e.type}
                  </span>
                  <span>{e.provider}</span>
                  <span className="text-muted-foreground/70">
                    {new Date(e.createdAt).toLocaleString('es-MX')}
                  </span>
                  {e.actor && <span className="text-muted-foreground/70">· {e.actor}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}
