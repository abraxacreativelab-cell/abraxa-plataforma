import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../api/auth/opciones';
import { identidadSellada } from '../../api/_auth/cabeceras';

export const metadata: Metadata = { title: 'Ajustes · ABRAXA Plataforma' };

/**
 * `/ajustes` — quién eres, en qué empresa estás, y cómo salir.
 *
 * Es la pantalla más pequeña del producto y hace cuatro cosas que ninguna otra:
 *
 *  1. **Le dice al invitado con qué cuenta entró.** En un evento, la mitad de
 *     la gente tiene dos cuentas de Google abiertas en el teléfono. Ver el
 *     correo escrito es lo que convierte "creo que entré" en "entré".
 *
 *  2. **Deja salir.** Sin esto, enseñarle el producto a la siguiente persona
 *     exige una ventana de incógnito. Es un enlace a la pantalla de NextAuth:
 *     cero JavaScript de cliente, cero `<SessionProvider>` — que habría
 *     obligado a tocar `app/layout.tsx`, que es de H5.
 *
 *  3. **Dice POR QUÉ, cuando algo falta.** Si el alta de la empresa falló —la
 *     API caída en el segundo del login, `PROXY_SECRET` sin poner— esto lo
 *     escribe con todas sus letras en vez de enseñar un hueco. Es la
 *     diferencia entre diagnosticar en diez segundos y adivinar delante de
 *     todos.
 *
 *  4. **Enseña el aislamiento funcionando.** Las dos fuentes que compara —la
 *     cookie firmada y las cabeceras selladas por el middleware— tienen que
 *     decir lo mismo. Si alguien forja `x-abraxa-session-email`, las dos
 *     siguen diciendo su propio correo, y se puede enseñar en vivo con un
 *     `curl` al lado.
 *
 * Componente de SERVIDOR. La identidad no cruza al navegador.
 */
export const dynamic = 'force-dynamic';

export default async function Page() {
  // Dos caminos independientes a la misma verdad, a propósito.
  const sesion = await getServerSession(authOptions);
  const sellada = identidadSellada(headers());

  const correo = sesion?.user?.email ?? sellada?.correo ?? null;
  const empresa = sesion?.user?.tenantSlug ?? sellada?.empresa ?? null;
  const nombreEmpresa = sesion?.user?.tenantName ?? null;
  const motivo = sesion?.user?.motivoSinEmpresa ?? null;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Ajustes</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Tu cuenta</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Con qué cuenta entraste y a qué empresa perteneces. Lo resuelve el servidor desde tu
          sesión: no hay nada aquí que el navegador pueda cambiar.
        </p>
      </header>

      {correo ? (
        <div className="space-y-8">
          <dl className="divide-y divide-border rounded-lg border border-border">
            <Fila etiqueta="Correo" valor={correo} />
            <Fila
              etiqueta="Empresa"
              valor={nombreEmpresa ?? empresa}
              vacio="Todavía no tienes empresa."
            />
            {empresa && nombreEmpresa ? <Fila etiqueta="Identificador" valor={empresa} /> : null}
          </dl>

          {!empresa && motivo ? (
            <div className="rounded-lg border border-border bg-muted/30 p-5">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Por qué no hay empresa
              </p>
              <p className="mt-2 text-sm">{motivo}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                Si fue algo pasajero, cerrar sesión y volver a entrar lo intenta de nuevo.
              </p>
            </div>
          ) : null}

          <nav className="flex flex-wrap gap-3">
            <Enlace href="/ritual">Ir al Ritual de Fundación</Enlace>
            <Enlace href="/ajustes/plan">Ver tu plan</Enlace>
            <Enlace href="/api/auth/signout">Cerrar sesión</Enlace>
          </nav>

          <details className="rounded-lg border border-border p-4 text-sm">
            <summary className="cursor-pointer font-mono text-xs uppercase tracking-widest text-muted-foreground">
              De dónde sale esto
            </summary>
            <dl className="mt-4 space-y-2 font-mono text-xs">
              <Origen
                etiqueta="cookie firmada"
                correo={sesion?.user?.email ?? null}
                empresa={sesion?.user?.tenantSlug ?? null}
              />
              <Origen
                etiqueta="cabeceras selladas"
                correo={sellada?.correo ?? null}
                empresa={sellada?.empresa ?? null}
              />
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Las dos filas tienen que decir lo mismo. La primera sale de la cookie que firmó el
              servidor; la segunda, de las cabeceras que el middleware reescribió antes de que esta
              pantalla se pintara. Lo que mandó el navegador se borró antes de llegar aquí.
            </p>
          </details>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 p-6">
          <p className="text-sm text-muted-foreground">
            No hay sesión. El middleware manda a la pantalla de entrada antes de llegar aquí, así
            que ver esto significa que la sesión existe pero no trae correo — algo que sólo pasa con
            una cookie a medio escribir.
          </p>
          <p className="mt-4">
            <Enlace href="/api/auth/signin">Entrar con Google</Enlace>
          </p>
        </div>
      )}
    </main>
  );
}

function Fila({
  etiqueta,
  valor,
  vacio,
}: {
  etiqueta: string;
  valor: string | null;
  vacio?: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="w-32 shrink-0 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        {etiqueta}
      </dt>
      <dd className={valor ? 'text-sm' : 'text-sm text-muted-foreground'}>
        {valor ?? vacio ?? '—'}
      </dd>
    </div>
  );
}

function Origen({
  etiqueta,
  correo,
  empresa,
}: {
  etiqueta: string;
  correo: string | null;
  empresa: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-muted-foreground">{etiqueta}</dt>
      <dd>
        {correo ?? '∅'} · {empresa ?? '∅'}
      </dd>
    </div>
  );
}

function Enlace({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm transition-colors hover:border-primary hover:text-primary"
    >
      {children}
    </a>
  );
}
