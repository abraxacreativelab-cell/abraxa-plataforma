import type { Metadata } from 'next';
import { LoadError } from '@abraxa/ui';
import { cargarPlan } from './_lib/datos';
import { SinCablear } from './estados';
import { Historial, QueIncluye, QuePausado, QueUsas } from './bloques';

export const metadata: Metadata = { title: 'Tu plan · ABRAXA Plataforma' };

/**
 * `/ajustes/plan` — qué incluye tu plan, qué estás usando, qué te falta.
 *
 * Componente de SERVIDOR: los datos se resuelven antes de pintar, así que no
 * hay parpadeo de "no tienes nada" en cada carga. Esa clase de parpadeo es
 * tolerable en una lista de contactos y no lo es aquí: medio segundo de
 * pantalla vacía en la vista del plan se lee como una cuenta cancelada.
 *
 * ── Tres estados, y ninguno es un cero silencioso ──────────────────────────
 *
 * Mismo criterio de H15 (`H15-crm.md §8`): 'datos', 'error' y 'sin-cablear'.
 * Ver `_lib/datos.ts` y `estados.tsx` para por qué el tercero existe.
 *
 * ── Y ninguno de los tres bloques es una tabla de precios ──────────────────
 *
 * Esta pantalla no vende: informa. Lo que el emprendedor tiene que poder
 * contestar al salir de aquí es "¿qué tengo?", "¿cuánto he usado?" y "¿por qué
 * esto está apagado?". La decisión de subir de plan sale de ver la promesa de
 * lo que no tiene — que por eso se muestra con candado y no se esconde.
 */
export default async function Page() {
  const resultado = await cargarPlan();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Ajustes</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Tu plan
          {resultado.estado === 'datos' && resultado.datos.plan && (
            <span className="ml-3 align-middle text-base font-normal text-muted-foreground">
              {resultado.datos.plan.name}
            </span>
          )}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Qué incluye, cuánto llevas usado y qué está pausado. Nada de lo que hayas creado se
          borra por un cambio de plan — si algo se apaga, se apaga, y aquí dice por qué.
        </p>
      </header>

      {resultado.estado === 'sin-cablear' && <SinCablear motivo={resultado.motivo} />}
      {resultado.estado === 'error' && <LoadError failure={resultado.falla} />}

      {resultado.estado === 'datos' && (
        <div className="space-y-10">
          <QueIncluye features={resultado.datos.features} />
          <QueUsas uso={resultado.datos.uso} />
          <QuePausado pausas={resultado.datos.pausas} features={resultado.datos.features} />
          <Historial historial={resultado.datos.historial} />
        </div>
      )}
    </main>
  );
}
