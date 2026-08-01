/**
 * Los tres bloques de `/ajustes/plan`. Ninguno es una tabla de precios.
 *
 *   1. Qué INCLUYE tu plan — con las bloqueadas a la vista y su promesa.
 *   2. Qué estás USANDO — con hueco declarado donde el dato no existe todavía.
 *   3. Qué está PAUSADO por plan — dicho claro, con el botón para reactivar.
 *
 * Componentes de servidor. No hay estado, no hay efectos: es una foto de la
 * cuenta. El único trozo interactivo es el botón del bloque 3, que vive en
 * `pausa-boton.tsx` y es lo único marcado `'use client'`.
 */
import { Badge, Icon } from '@abraxa/ui';
import { ConsumoSinCablear } from './estados';
import { BotonPausa } from './pausa-boton';
import type { CambioDePlan, Feature, Pausa, Renglon } from './_lib/tipos';

// ════════════════════════════════════════════════════════════════════════════
// 1 · Qué incluye tu plan
// ════════════════════════════════════════════════════════════════════════════

/**
 * Las que NO tiene se MUESTRAN, con candado y con su promesa.
 *
 * Es la misma decisión que tomó H11 para las áreas bloqueadas
 * (`ports.ts:AreaState`): *"las bloqueadas se MUESTRAN con candado y su
 * promesa: la curiosidad es el motor del producto"*. Esconder lo que alguien no
 * tiene no le ahorra nada — le quita la razón para subir de plan.
 */
export function QueIncluye({ features }: { features: Feature[] }) {
  const incluidas = features.filter((f) => f.granted);
  const faltantes = features.filter((f) => !f.granted);

  return (
    <section>
      <h2 className="text-lg font-medium tracking-tight">Qué incluye tu plan</h2>

      <ul className="mt-4 space-y-2">
        {incluidas.map((f) => (
          <li
            key={f.key}
            className="flex items-start gap-3 rounded-lg border border-border bg-card/40 px-4 py-3"
          >
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--color-success-fg))]" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{f.label}</span>
                {f.source === 'override' && (
                  <Badge variant="outline" className="text-[10px]">
                    {f.expiresAt ? `cortesía hasta el ${fecha(f.expiresAt)}` : 'cortesía'}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{f.blurb}</p>
            </div>
          </li>
        ))}
      </ul>

      {faltantes.length > 0 && (
        <>
          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Lo que todavía no tienes
          </p>
          <ul className="mt-3 space-y-2">
            {faltantes.map((f) => (
              <li
                key={f.key}
                className="flex items-start gap-3 rounded-lg border border-dashed border-border/70 px-4 py-3"
              >
                <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <span className="text-sm text-muted-foreground">{f.label}</span>
                  {/* La promesa, visible. Es el copy que también viaja en el 402. */}
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{f.blurb}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2 · Qué estás usando
// ════════════════════════════════════════════════════════════════════════════

export function QueUsas({ uso }: { uso: Renglon[] }) {
  return (
    <section>
      <h2 className="text-lg font-medium tracking-tight">Qué estás usando</h2>

      <div className="mt-4 space-y-2">
        {uso.map((r) => {
          if (r.estado === 'sin-cablear') {
            return (
              <ConsumoSinCablear key={r.key} label={r.label} limite={r.limite} motivo={r.motivo} />
            );
          }

          if (r.estado === 'error') {
            return (
              <div
                key={r.key}
                className="rounded-lg border border-[hsl(var(--color-error-border))] bg-[hsl(var(--color-error-bg))] px-4 py-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{r.label}</span>
                  <span className="font-mono text-xs uppercase tracking-widest text-[hsl(var(--color-error-fg))]">
                    no se pudo leer
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{r.motivo}</p>
              </div>
            );
          }

          const { limit, used, exceeded } = r.cuota;
          const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;

          return (
            <div key={r.key} className="rounded-lg border border-border bg-card/40 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm">{r.label}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {fmt(used, r.esDinero)}
                  {limit === null ? ' · sin límite' : ` de ${fmt(limit, r.esDinero)}`}
                </span>
              </div>

              {pct !== null && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={exceeded ? 'h-full bg-[hsl(var(--color-error))]' : 'h-full bg-primary'}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}

              {exceeded && (
                <p className="mt-1.5 text-xs text-[hsl(var(--color-error-fg))]">
                  Llegaste al límite de tu plan. Nada se borró; para agregar más, sube de plan.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3 · Qué está pausado
// ════════════════════════════════════════════════════════════════════════════

/**
 * Un flujo apagado sin explicación visible es una llamada a soporte
 * garantizada. Y hay que decir DOS cosas distintas:
 *
 *   · lo que pausó el PLAN — se reactiva pagando, y nada se borró;
 *   · lo que pausó ÉL — se reactiva con un clic, y el producto no se lo va a
 *     tocar cuando vuelva a pagar.
 *
 * Separarlas es lo mismo que hace `apply_plan_change` por dentro (criterio #9);
 * mezclarlas en la pantalla desharía en la cara del usuario la distinción que
 * el sistema mantiene por debajo.
 */
export function QuePausado({
  pausas,
  features,
}: {
  pausas: Pausa[];
  features: Feature[];
}) {
  if (pausas.length === 0) return null;

  const etiqueta = (key: string): string => features.find((f) => f.key === key)?.label ?? key;
  const porPlan = pausas.filter((p) => p.pausedBy === 'plan');
  const porUsuario = pausas.filter((p) => p.pausedBy === 'user');

  return (
    <section>
      <h2 className="text-lg font-medium tracking-tight">Qué está pausado</h2>

      {porPlan.length > 0 && (
        <div className="mt-4 rounded-lg border border-[hsl(var(--color-warning-border))] bg-[hsl(var(--color-warning-bg))] p-4">
          <p className="text-sm">
            Estas funciones están <strong>pausadas por tu plan</strong>. No se borró nada: cuando
            vuelvas a contratarlas, siguen exactamente donde las dejaste.
          </p>
          <ul className="mt-3 space-y-1.5">
            {porPlan.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="lock" className="h-3.5 w-3.5 shrink-0" />
                <span>{etiqueta(p.featureKey)}</span>
                {p.resourceRef !== '*' && (
                  <code className="text-xs text-muted-foreground/60">{p.resourceRef}</code>
                )}
                <span className="text-xs text-muted-foreground/50">
                  desde el {fecha(p.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {porUsuario.length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-card/40 p-4">
          <p className="text-sm text-muted-foreground">
            Y estas las pausaste tú. Se quedan así hasta que las enciendas — un cambio de plan no
            las toca.
          </p>
          <ul className="mt-3 space-y-2">
            {porUsuario.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  {etiqueta(p.featureKey)}
                  {p.note && (
                    <span className="ml-2 text-xs text-muted-foreground/60">— {p.note}</span>
                  )}
                </span>
                <BotonPausa feature={p.featureKey} resourceRef={p.resourceRef} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// La bitácora — por qué perdiste algo
// ════════════════════════════════════════════════════════════════════════════

const MOTIVO: Record<CambioDePlan['reason'], string> = {
  checkout: 'contrataste',
  payment_failed: 'un pago no pasó',
  cancel: 'cancelaste',
  staff: 'lo cambió el equipo de ABRAXA',
  trial_end: 'terminó tu prueba',
};

export function Historial({ historial }: { historial: CambioDePlan[] }) {
  if (historial.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-medium tracking-tight">Historial de tu plan</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Está aquí para contestar &ldquo;¿por qué perdí esto?&rdquo; sin que tengas que preguntar.
      </p>

      <ol className="mt-4 space-y-2">
        {historial.map((c) => (
          <li key={c.id} className="rounded-lg border border-border/70 bg-card/30 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm">
                {c.fromPlan ? `${c.fromPlan} → ${c.toPlan}` : c.toPlan}
                {c.toStatus !== 'active' && (
                  <span className="ml-2 text-[hsl(var(--color-warning-fg))]">({c.toStatus})</span>
                )}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {fecha(c.createdAt)} · {MOTIVO[c.reason] ?? c.reason}
              </span>
            </div>
            {c.effects.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {c.effects.filter((e) => e.action === 'restored').length > 0 &&
                  `Se reactivaron ${c.effects.filter((e) => e.action === 'restored').length}. `}
                {c.effects.filter((e) => e.action !== 'restored').length > 0 &&
                  `Se pausaron ${c.effects.filter((e) => e.action !== 'restored').length}, sin borrar nada.`}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── Formato ─────────────────────────────────────────────────────────────────
//
// `es-MX` y UTC explícito: el servidor pinta esto, y sin fijar la zona el
// servidor y el navegador pueden escribir días distintos para el mismo
// instante. Ver el comentario equivalente en la pantalla de contactos de H15.

const fmt = (n: number, dinero?: boolean): string =>
  dinero
    ? `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : n.toLocaleString('es-MX');

const fecha = (iso: string): string =>
  new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
