'use client';

import * as React from 'react';
import { Button, Input } from '@abraxa/ui';

/**
 * El formulario que convierte un visitante en un cliente.
 *
 * Pide UNA cosa: el nombre del negocio. Todo lo demás —correo, tarjeta,
 * monto— lo pide Stripe, que ya sabe hacerlo mejor que nosotros y en el que
 * la gente ya confía. Cada campo de más aquí es gente que no llega al pago.
 *
 * El nombre no es un trámite: de ahí sale el slug de su URL
 * (`mi.abraxa.club/panaderia-lupita`), así que se muestra en vivo cómo va a
 * quedar. Ver el resultado antes de pagar evita el "¿y ahora cómo lo cambio?".
 */

/**
 * Base de la API.
 *
 * Vacía = relativa al mismo origen, que es lo correcto en producción (nginx
 * manda `/billing` a la API). En desarrollo, con el web en :3000 y la API en
 * :3100, hay que poner `NEXT_PUBLIC_API_BASE_URL=http://localhost:3100`.
 */
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/** Espeja `slugify()` de packages/billing. Sólo para la vista previa: el slug
 *  de verdad lo decide el servidor, que además resuelve colisiones. */
function vistaPreviaSlug(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function FormularioEmpezar() {
  const [nombre, setNombre] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const slug = vistaPreviaSlug(nombre);
  const listo = nombre.trim().length >= 2;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!listo || enviando) return;

    setEnviando(true);
    setError(null);

    try {
      const r = await fetch(`${API}/billing/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessName: nombre.trim() }),
      });

      const data = (await r.json().catch(() => null)) as
        | { url?: string | null; error?: { message?: string } }
        | null;

      if (!r.ok || !data?.url) {
        // Un mensaje honesto: no se dice "listo" cuando no lo está, y no se
        // culpa al usuario de algo que falló de nuestro lado.
        setError(
          data?.error?.message ??
            'No pudimos abrir el pago. Vuelve a intentar en un momento — no se te cobró nada.',
        );
        setEnviando(false);
        return;
      }

      // Se deja `enviando` en true a propósito: el navegador está por irse a
      // Stripe y reactivar el botón invita a un segundo clic que crearía una
      // segunda sesión de pago.
      window.location.assign(data.url);
    } catch {
      setError('No pudimos conectarnos. Revisa tu internet y vuelve a intentar.');
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex w-full flex-col gap-3" noValidate>
      <label htmlFor="negocio" className="text-sm text-muted-foreground">
        ¿Cómo se llama tu negocio?
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="negocio"
          name="negocio"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Panadería Lupita"
          autoComplete="organization"
          maxLength={120}
          disabled={enviando}
          aria-describedby="pista-slug"
          className="h-11 flex-1 text-base"
        />
        <Button type="submit" size="lg" disabled={!listo || enviando} className="h-11 sm:w-auto">
          {enviando ? 'Abriendo el pago…' : 'Empezar'}
        </Button>
      </div>

      <p id="pista-slug" className="min-h-5 text-sm text-muted-foreground">
        {slug ? (
          <>
            Tu espacio va a ser{' '}
            <span className="font-mono text-foreground">mi.abraxa.club/{slug}</span>
          </>
        ) : (
          'Con eso basta para empezar. El correo y el pago los pide Stripe.'
        )}
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[hsl(var(--color-error-border))] bg-[hsl(var(--color-error-bg))] px-3 py-2 text-sm text-[hsl(var(--color-error-fg))]"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
