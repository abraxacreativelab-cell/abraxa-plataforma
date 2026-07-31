import type { Metadata } from 'next';
import { LoadError } from '@abraxa/ui';
import { cargarContactos, cargarEmbudo } from './datos';
import { SinCablear } from './estados';
import { Tablero } from './tablero';
import { Lista } from './lista';

export const metadata: Metadata = { title: 'Contactos · ABRAXA Plataforma' };

/**
 * `/contactos` — la ficha de cada persona que le habla al negocio.
 *
 * Componente de SERVIDOR: los datos se resuelven antes de pintar, así que no
 * hay parpadeo de lista vacía en cada carga. El único trozo de cliente es el
 * filtro de la lista, que es interacción pura.
 *
 * `ahora` se calcula UNA vez aquí y se pasa hacia abajo. Si cada "hace 3 h" lo
 * calculara solo, el servidor y el navegador pintarían valores distintos con
 * milisegundos de diferencia y React marcaría un desajuste de hidratación.
 */
export default async function Page() {
  const [contactos, embudo] = await Promise.all([cargarContactos(), cargarEmbudo()]);
  const ahora = Date.now();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Ventas</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Contactos</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Una persona, una ficha — aunque te escriba por WhatsApp, te mande un correo y te
          etiquete en Instagram. Todo lo que pasó con ella, en una sola línea de tiempo.
        </p>
      </header>

      <div className="space-y-8">
        {embudo.estado === 'datos' && (
          <Tablero etapas={embudo.datos.stages} moneda={embudo.datos.currency} />
        )}
        {embudo.estado === 'error' && <LoadError failure={embudo.falla} />}

        {contactos.estado === 'datos' && (
          <>
            {contactos.datos.filterTruncated && (
              <p className="rounded-md border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
                El filtro tocó más contactos de los que caben en una consulta: esta lista está
                <strong className="text-foreground"> incompleta</strong>. Afina el filtro o usa la
                búsqueda.
              </p>
            )}
            <Lista contactos={contactos.datos.contacts} ahora={ahora} />
          </>
        )}
        {contactos.estado === 'error' && <LoadError failure={contactos.falla} />}
        {contactos.estado === 'sin-cablear' && <SinCablear motivo={contactos.motivo} />}
      </div>
    </main>
  );
}
