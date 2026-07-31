/**
 * Las tarjetas de lo que ya está conectado, y el formulario para conectar lo
 * que falta.
 *
 * Todo es de SERVIDOR: los formularios llaman a las acciones de `acciones.ts`
 * directamente. No hay una línea de JavaScript de cliente en esta pantalla, y
 * eso es deliberado — el secreto que se escribe aquí no debe pasar por código
 * del navegador ni quedar en el estado de un componente.
 */
import { Icon } from '@abraxa/ui';
import { conectar, revocar, verificar } from './acciones';
import { Insignia } from './estados';
import type { Integration, ProviderInfo } from './tipos';

function fecha(iso: string | null): string {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'nunca'
    : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Los datos de `config` que sí se pueden enseñar. El secreto no está aquí. */
function detalles(i: Integration): Array<[string, string]> {
  const fuera = new Set(['secret', 'apiKey', 'token', 'authToken']);
  return Object.entries(i.config ?? {})
    .filter(([k, v]) => !fuera.has(k) && (typeof v === 'string' || typeof v === 'number'))
    .slice(0, 4)
    .map(([k, v]): [string, string] => [k, String(v)]);
}

export function Tarjeta({ integracion }: { integracion: Integration }) {
  const i = integracion;
  return (
    <article className="rounded-lg border border-border bg-card/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium">{i.label}</h3>
          <p className="mt-0.5 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {i.provider}
            {i.externalAccountId ? ` · ${i.externalAccountId}` : ''}
          </p>
        </div>
        <Insignia estado={i.status} />
      </div>

      {/* El motivo va ARRIBA y no escondido: si no está funcionando, es lo
          primero que hay que leer. */}
      {i.status === 'error' && i.lastError && (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-200">
          {i.lastError}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Credencial</dt>
          {/* La huella: distingue una de otra sin permitir usar ninguna. */}
          <dd className="mt-0.5 font-mono text-muted-foreground/90">{i.fingerprint ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Comprobada</dt>
          <dd className="mt-0.5">{fecha(i.verifiedAt)}</dd>
        </div>
        {i.expiresAt && (
          <div>
            <dt className="text-muted-foreground">Caduca</dt>
            <dd className="mt-0.5">{fecha(i.expiresAt)}</dd>
          </div>
        )}
        {detalles(i).map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="mt-0.5 break-all">{v}</dd>
          </div>
        ))}
      </dl>

      {i.status !== 'revoked' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={verificar}>
            <input type="hidden" name="id" value={i.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-card"
            >
              <Icon name="refresh" className="h-3 w-3" />
              Volver a probar
            </button>
          </form>
          <form action={revocar}>
            <input type="hidden" name="id" value={i.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-card hover:text-foreground"
            >
              <Icon name="lock" className="h-3 w-3" />
              Desconectar
            </button>
          </form>
        </div>
      )}
    </article>
  );
}

/**
 * El formulario de un proveedor.
 *
 * `type="password"` y `autoComplete="off"`: el gestor de contraseñas del
 * navegador no tiene por qué guardar la llave de la API del negocio, y el
 * campo nunca llega relleno — ni siquiera con lo que se acaba de escribir.
 */
export function Formulario({ proveedor }: { proveedor: ProviderInfo }) {
  const p = proveedor;
  return (
    <form
      action={conectar}
      className="rounded-lg border border-border bg-card/30 p-5"
      autoComplete="off"
    >
      <input type="hidden" name="provider" value={p.name} />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-medium">{p.label}</h3>
        {!p.fallbackAllowed && (
          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
            sólo con cuenta propia
          </span>
        )}
      </div>

      {!p.fallbackAllowed && (
        <p className="mt-2 text-xs text-muted-foreground/80">{p.fallbackReason}</p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="text-muted-foreground">{p.secretLabel}</span>
          <input
            name="secret"
            type="password"
            required
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="text-xs">
          <span className="text-muted-foreground">Cómo la llamas (opcional)</span>
          <input
            name="label"
            type="text"
            placeholder={p.label}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>

        {p.configFields.map((campo) => (
          <label key={campo.key} className="text-xs">
            <span className="text-muted-foreground">
              {campo.label}
              {campo.required ? '' : ' (opcional)'}
            </span>
            <input
              name={campo.key}
              type="text"
              required={campo.required}
              placeholder={campo.placeholder}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        ))}
      </div>

      <button
        type="submit"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <Icon name="plus" className="h-4 w-4" />
        Conectar y comprobar
      </button>
      <p className="mt-2 text-[11px] text-muted-foreground/70">
        Se guarda cifrada y se comprueba con {p.label} antes de darla por buena. Si el proveedor no
        la acepta, se queda guardada y te decimos por qué — no te dejamos con una palomita verde
        que no significa nada.
      </p>
    </form>
  );
}
