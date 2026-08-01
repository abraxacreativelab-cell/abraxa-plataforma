'use client';

/**
 * El único trozo de cliente de esta pantalla.
 *
 * Reactivar algo que uno mismo pausó tiene que ser un clic y no un
 * procedimiento — si exige escribirle a soporte, la pausa deja de ser una
 * herramienta y se vuelve una trampa.
 *
 * ── Lo que este botón NO hace ──────────────────────────────────────────────
 *
 * No reactiva lo que pausó el PLAN. Eso no se arregla con un clic: se arregla
 * pagando, y `applyPlanChange()` lo suelta solo cuando el pago entra. Poner
 * aquí un botón que dijera "reactivar" para una pausa de plan sería prometer
 * algo que el botón no puede cumplir.
 *
 * ── `useState` y no `useTransition` ────────────────────────────────────────
 *
 * Éste es un `fetch` a una ruta del BFF, no una navegación ni una server
 * action: no hay nada que React pueda dejar en segundo plano mientras tanto.
 * `useTransition` con una función `async` en React 18 sólo mantiene `isPending`
 * hasta el primer `await`, así que el botón se re-habilitaría a media petición
 * y se podría picar dos veces.
 */
import { useState } from 'react';
import { Button } from '@abraxa/ui';

type Estado = 'listo' | 'enviando' | 'hecho' | 'falla';

export function BotonPausa({
  feature,
  resourceRef,
}: {
  feature: string;
  resourceRef: string;
}) {
  const [estado, setEstado] = useState<Estado>('listo');
  const [motivo, setMotivo] = useState<string | null>(null);

  if (estado === 'hecho') {
    return <span className="text-xs text-[hsl(var(--color-success-fg))]">Reactivada</span>;
  }

  async function reactivar(): Promise<void> {
    setEstado('enviando');
    setMotivo(null);

    try {
      const r = await fetch('/api/entitlements/pausas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feature, resourceRef, paused: false }),
      });

      /*
       * El 404 aquí no es "no existe la pausa": es que la ruta BFF todavía no
       * está montada — `apps/web/app/api/**` es de H18. Se dice tal cual en vez
       * de "algo falló", que mandaría a alguien a revisar su cuenta cuando lo
       * que falta es un merge.
       */
      if (r.status === 404) {
        setMotivo('Falta cablear la ruta (H18).');
        setEstado('falla');
        return;
      }
      if (!r.ok) {
        setMotivo('No se pudo reactivar.');
        setEstado('falla');
        return;
      }
      setEstado('hecho');
    } catch {
      setMotivo('No se pudo reactivar.');
      setEstado('falla');
    }
  }

  return (
    <span className="flex items-center gap-2">
      {motivo && <span className="text-xs text-[hsl(var(--color-error-fg))]">{motivo}</span>}
      <Button
        variant="outline"
        size="sm"
        disabled={estado === 'enviando'}
        onClick={() => {
          void reactivar();
        }}
      >
        {estado === 'enviando' ? 'Reactivando…' : 'Reactivar'}
      </Button>
    </span>
  );
}
