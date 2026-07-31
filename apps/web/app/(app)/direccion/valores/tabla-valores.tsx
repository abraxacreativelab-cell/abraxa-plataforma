'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  CheckCircle2,
  GitCompareArrows,
  KeyRound,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Undo2,
  X,
} from 'lucide-react';
import type { VaultRow } from '@abraxa/vault/api';
import {
  accionAprobar,
  accionBorrarValor,
  accionDesactivar,
  accionGuardarValor,
  accionResolverConflicto,
} from '../_lib/actions';
import {
  Avisos,
  Boton,
  Entrada,
  Insignia,
  Selector,
  SinNada,
  Tarjeta,
  useAvisos,
} from '../_components/ui';
import { ModalValor } from './modal-valor';

export interface AreaSimple {
  slug: string;
  label: string;
}

/** Lo mínimo que hace falta para pintar una cifra: el tipo, el número y la moneda. */
interface Pintable {
  kind: VaultRow['kind'];
  value: number | null;
  value_text?: string | null;
  value_json?: unknown;
  currency?: string | null;
  unit?: string | null;
}

/** Espejo de `formatVault`, en el cliente. Sólo para pintar. */
function mostrar(v: Pintable): string {
  const num = (n: number, opts?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat('es-MX', opts).format(n);

  switch (v.kind) {
    case 'money':
      return v.value == null
        ? '—'
        : num(Number(v.value), {
            style: 'currency',
            currency: v.currency || 'MXN',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          });
    case 'percent':
      return v.value == null ? '—' : `${Number(v.value)}%`;
    case 'number':
      return v.value == null ? '—' : `${num(Number(v.value))}${v.unit ? ` ${v.unit}` : ''}`;
    case 'bool':
      return typeof v.value_json === 'boolean' ? (v.value_json ? 'Sí' : 'No') : '—';
    case 'list':
      return Array.isArray(v.value_json) && v.value_json.length
        ? (v.value_json as unknown[]).join(', ')
        : '—';
    default:
      return v.value_text || '—';
  }
}

/** `true` si un documento posterior desmiente esta cifra y nadie ha decidido. */
function enConflicto(v: VaultRow): boolean {
  return v.conflict_at != null;
}

/** Lo que propone el documento nuevo, listo para pintar al lado de lo vigente. */
function loPropuesto(v: VaultRow): Pintable {
  return {
    kind: v.kind,
    value: v.conflict_value ?? null,
    value_text: v.conflict_value_text ?? null,
    currency: v.conflict_currency ?? v.currency,
    unit: v.unit,
  };
}

/**
 * `true` si la propuesta no trae NADA que aplicar.
 *
 * Espejo en el cliente de `propuestaSinCifra()` del servicio — el mismo espejo
 * que `mostrar()` es de `formatVault()`, y por la misma razón: este archivo no
 * puede importar de `@abraxa/vault/api` en el navegador.
 *
 * Sin esto, la fila decía «Un documento nuevo dice —» y ofrecía «Aceptar»
 * igual. Pulsarlo dejaba el precio vigente y VACÍO. El servicio ya lo rechaza;
 * esto evita que el botón lo ofrezca siquiera, que es lo que el emprendedor ve.
 */
function propuestaSinCifra(v: VaultRow): boolean {
  return mostrar(loPropuesto(v)) === '—';
}

const NOMBRE_TIPO: Record<string, string> = {
  money: 'Monto',
  percent: 'Porcentaje',
  number: 'Número',
  text: 'Texto',
  date: 'Fecha',
  bool: 'Sí / No',
  list: 'Lista',
};

/**
 * React 18 exige que el callback de `startTransition` sea SÍNCRONO: pasarle una
 * función async es una capacidad de React 19. Como aquí se espera el resultado
 * de una Server Action para poder enseñar su mensaje, el estado "guardando" se
 * lleva a mano.
 */
function usePendiente() {
  const [pendiente, setPendiente] = useState(false);
  const correr = async (fn: () => Promise<void>) => {
    setPendiente(true);
    try {
      await fn();
    } finally {
      setPendiente(false);
    }
  };
  return { pendiente, correr };
}

export type FiltroEstado = 'todos' | 'borrador' | 'activo' | 'conflicto';

export function TablaValores({
  valores,
  areas,
  puedeEditar,
  filtroInicial,
  areaInicial,
}: {
  valores: VaultRow[];
  areas: AreaSimple[];
  puedeEditar: boolean;
  filtroInicial: 'todos' | 'borrador' | 'conflicto';
  areaInicial: string;
}) {
  const { avisos, ok, error, cerrar } = useAvisos();
  const { pendiente, correr: ejecutar } = usePendiente();

  const [busqueda, setBusqueda] = useState('');
  const [filtroArea, setFiltroArea] = useState(areaInicial);
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>(filtroInicial);
  const [editando, setEditando] = useState<VaultRow | null>(null);
  const [creando, setCreando] = useState(false);

  const borradores = valores.filter((v) => !v.active).length;
  const conflictos = valores.filter(enConflicto).length;

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    return valores.filter((v) => {
      if (filtroEstado === 'borrador' && v.active) return false;
      if (filtroEstado === 'activo' && !v.active) return false;
      if (filtroEstado === 'conflicto' && !enConflicto(v)) return false;
      if (filtroArea === '__ninguna' ? v.area_slug != null : filtroArea && v.area_slug !== filtroArea)
        return false;
      if (!t) return true;
      return [v.key, v.label, v.note ?? ''].some((c) => c.toLowerCase().includes(t));
    });
  }, [valores, busqueda, filtroArea, filtroEstado]);

  const grupos = useMemo(() => {
    const orden = [...areas.map((a) => a.slug), '__general'];
    const porArea = new Map<string, VaultRow[]>();
    for (const v of filtrados) {
      const k = v.area_slug ?? '__general';
      const lista = porArea.get(k);
      if (lista) lista.push(v);
      else porArea.set(k, [v]);
    }
    return orden
      .filter((k) => porArea.has(k))
      .map((k) => ({
        slug: k,
        label: areas.find((a) => a.slug === k)?.label ?? 'Sin área',
        valores: porArea.get(k)!,
      }));
  }, [filtrados, areas]);

  const correr = (fn: () => Promise<{ ok: boolean; mensaje: string }>) =>
    void ejecutar(async () => {
      const r = await fn();
      if (r.ok) ok(r.mensaje);
      else error(r.mensaje);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Los números de tu negocio</h2>
          <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
            Cada uno vive en un solo lugar: aquí. Si lo cambias, se actualiza solo en tus
            contratos, tus mensajes y lo que contestan tus agentes — escribiendo{' '}
            <code className="text-[hsl(var(--primary))]">{'{valor.la_clave}'}</code>.
          </p>
        </div>
        {puedeEditar ? (
          <Boton variante="primario" onClick={() => setCreando(true)}>
            <Plus className="h-3.5 w-3.5" /> Nuevo número
          </Boton>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]/60" />
          <Entrada
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por clave, nombre o nota…"
            className="pl-8"
            aria-label="Buscar valores"
          />
        </div>

        <Selector
          value={filtroArea}
          onChange={(e) => setFiltroArea(e.target.value)}
          className="sm:w-48"
          aria-label="Filtrar por área"
        >
          <option value="">Todas las áreas</option>
          {areas.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.label}
            </option>
          ))}
          <option value="__ninguna">Sin área</option>
        </Selector>

        <Selector
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)}
          className="sm:w-52"
          aria-label="Filtrar por estado"
        >
          <option value="todos">Todos</option>
          <option value="activo">Sólo los vigentes</option>
          <option value="borrador">Sólo los que esperan tu visto bueno</option>
          <option value="conflicto">Sólo los que un documento contradice</option>
        </Selector>

        <div className="flex items-center gap-2 text-xs sm:ml-auto">
          <span className="font-mono text-[hsl(var(--muted-foreground))]">
            {filtrados.length} de {valores.length}
          </span>
          {conflictos > 0 ? (
            <Insignia tono="alerta">{conflictos} en conflicto</Insignia>
          ) : null}
          {borradores > 0 ? (
            <Insignia tono="borrador">
              {borradores} por revisar
            </Insignia>
          ) : null}
        </div>
      </div>

      {conflictos > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2.5 text-sm">
          <GitCompareArrows className="h-4 w-4 shrink-0 text-rose-400" />
          <p className="flex-1 leading-snug">
            Un documento nuevo contradice <b>{conflictos}</b> número
            {conflictos === 1 ? '' : 's'} que ya habías aprobado.{' '}
            <span className="text-[hsl(var(--muted-foreground))]">
              No cambié ninguno: sigue vigente el que aprobaste. Decide tú cuál se queda.
            </span>
          </p>
          {filtroEstado !== 'conflicto' ? (
            <Boton variante="contorno" onClick={() => setFiltroEstado('conflicto')}>
              Ver sólo ésos
            </Boton>
          ) : null}
        </div>
      ) : null}

      {!puedeEditar && valores.length > 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
          <ShieldAlert className="h-3.5 w-3.5" />
          Puedes verlos, pero no cambiarlos. Editar los números del negocio requiere acceso a{' '}
          <b>Dirección</b>, porque cambian lo que dicen los contratos y los agentes de todas las
          áreas.
        </div>
      ) : null}

      {valores.length === 0 ? (
        <SinNada
          titulo="Todavía no hay números"
          descripcion="Pega un documento con tus precios y te propongo los que encuentre, o créalos tú a mano."
        >
          {puedeEditar ? (
            <Boton variante="primario" onClick={() => setCreando(true)}>
              <Plus className="h-3.5 w-3.5" /> Crear el primero
            </Boton>
          ) : null}
        </SinNada>
      ) : filtrados.length === 0 ? (
        <SinNada
          titulo="Ninguno coincide con el filtro"
          descripcion="Prueba con otra palabra o quita los filtros."
        />
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <Tarjeta key={g.slug} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-2">
                <KeyRound className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                <h3 className="flex-1 text-sm font-medium">{g.label}</h3>
                <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                  {g.valores.length}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Valores canónicos de {g.label}</caption>
                  <thead>
                    <tr className="border-b border-[hsl(var(--border))] text-left text-[10px] font-mono uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                      <th scope="col" className="px-4 py-2 font-medium">Clave</th>
                      <th scope="col" className="px-4 py-2 font-medium">Nombre</th>
                      <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Tipo</th>
                      <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Aplica a</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Valor</th>
                      <th scope="col" className="px-4 py-2 font-medium">Estado</th>
                      {puedeEditar ? <th scope="col" className="w-px px-4 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {g.valores.map((v) => (
                      <Fragment key={v.id}>
                      <tr
                        className={`border-b border-[hsl(var(--border))]/50 last:border-0 transition-colors ${
                          enConflicto(v)
                            ? 'bg-rose-500/[0.05] hover:bg-rose-500/[0.09]'
                            : v.active
                              ? 'hover:bg-[hsl(var(--muted))]/40'
                              : 'bg-amber-500/[0.04] hover:bg-amber-500/[0.08]'
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <code className="whitespace-nowrap text-[11px] text-[hsl(var(--primary))]">
                            {v.key}
                          </code>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="min-w-0">
                            <div className="truncate">{v.label}</div>
                            {v.note ? (
                              <div className="max-w-[280px] truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                                {v.note}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="hidden px-4 py-2.5 text-xs text-[hsl(var(--muted-foreground))] md:table-cell">
                          {NOMBRE_TIPO[v.kind] ?? v.kind}
                        </td>
                        <td className="hidden px-4 py-2.5 lg:table-cell">
                          <Insignia tono={v.scope_type === 'area' ? 'info' : 'neutro'}>
                            {v.scope_type === 'area' ? `Sólo ${v.scope_id}` : 'Todo el negocio'}
                          </Insignia>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums">
                          {mostrar(v)}
                        </td>
                        <td className="px-4 py-2.5">
                          {enConflicto(v) ? (
                            <Insignia
                              tono="alerta"
                              title="Un documento posterior dice otra cosa. Lo de abajo sigue vigente hasta que decidas."
                            >
                              <GitCompareArrows className="h-2.5 w-2.5" /> En conflicto
                            </Insignia>
                          ) : v.active ? (
                            <Insignia tono="activo" title="Se está usando ahora mismo">
                              Vigente
                            </Insignia>
                          ) : (
                            <Insignia tono="borrador" title="Salió de un documento; nadie lo usa hasta que lo apruebes">
                              Por revisar
                            </Insignia>
                          )}
                        </td>
                        {puedeEditar ? (
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              {v.active ? (
                                <Boton
                                  variante="silencioso"
                                  className="h-7 px-2 text-xs"
                                  title="Dejar de usarlo sin borrarlo"
                                  disabled={pendiente}
                                  onClick={() => correr(() => accionDesactivar(v.id))}
                                >
                                  <Undo2 className="h-3.5 w-3.5" />
                                  <span className="sr-only">Devolver a borrador</span>
                                </Boton>
                              ) : (
                                <Boton
                                  variante="silencioso"
                                  className="h-7 px-2 text-xs text-[hsl(var(--primary))]"
                                  title="Aprobar y empezar a usarlo en todos lados"
                                  disabled={pendiente}
                                  onClick={() => correr(() => accionAprobar(v.id))}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
                                </Boton>
                              )}
                              <Boton
                                variante="silencioso"
                                className="h-7 w-7 px-0"
                                title="Editar"
                                onClick={() => setEditando(v)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span className="sr-only">Editar {v.label}</span>
                              </Boton>
                            </div>
                          </td>
                        ) : null}
                      </tr>

                      {/*
                        La contradicción, enseñada entera: qué se está usando,
                        qué dice el documento nuevo, y las dos únicas salidas.
                        Sin esta fila, «En conflicto» sería una etiqueta sin
                        manera de hacer nada al respecto.
                      */}
                      {enConflicto(v) ? (
                        <tr className="border-b border-[hsl(var(--border))]/50 bg-rose-500/[0.03] last:border-0">
                          <td colSpan={puedeEditar ? 7 : 6} className="px-4 pb-3 pt-0">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                              <span className="text-[hsl(var(--muted-foreground))]">
                                {propuestaSinCifra(v) ? (
                                  <>
                                    Un documento nuevo habla de este número pero{' '}
                                    <b className="text-[hsl(var(--foreground))]">
                                      no dice una cifra
                                    </b>
                                    , y tú aprobaste{' '}
                                    <b className="tabular-nums text-[hsl(var(--foreground))]">
                                      {mostrar(v)}
                                    </b>
                                    . Se sigue usando el tuyo.
                                  </>
                                ) : (
                                  <>
                                    Un documento nuevo dice{' '}
                                    <b className="tabular-nums text-[hsl(var(--foreground))]">
                                      {mostrar(loPropuesto(v))}
                                    </b>{' '}
                                    donde tú aprobaste{' '}
                                    <b className="tabular-nums text-[hsl(var(--foreground))]">
                                      {mostrar(v)}
                                    </b>
                                    . Se sigue usando el tuyo.
                                  </>
                                )}
                              </span>
                              {v.conflict_note ? (
                                <span className="text-[hsl(var(--muted-foreground))]/70">
                                  «{v.conflict_note}»
                                </span>
                              ) : null}
                              {puedeEditar ? (
                                <div className="flex items-center gap-1">
                                  {/*
                                    Sin cifra que aplicar no hay nada que
                                    aceptar: hacerlo dejaría el valor vigente y
                                    VACÍO. En vez del botón se ofrece la salida
                                    que sí resuelve — escribir el número.
                                  */}
                                  {propuestaSinCifra(v) ? (
                                    <Boton
                                      variante="contorno"
                                      className="h-7 px-2 text-xs"
                                      disabled={pendiente}
                                      title="El documento no trae un número. Escríbelo tú y la contradicción se retira."
                                      onClick={() => setEditando(v)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" /> Escribir el número
                                    </Boton>
                                  ) : (
                                    <Boton
                                      variante="contorno"
                                      className="h-7 px-2 text-xs"
                                      disabled={pendiente}
                                      title="Usar la cifra del documento nuevo a partir de ahora"
                                      onClick={() =>
                                        correr(() => accionResolverConflicto(v.id, 'aceptar'))
                                      }
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Usar{' '}
                                      {mostrar(loPropuesto(v))}
                                    </Boton>
                                  )}
                                  <Boton
                                    variante="silencioso"
                                    className="h-7 px-2 text-xs"
                                    disabled={pendiente}
                                    title="Quedarse con la cifra aprobada y olvidar la del documento"
                                    onClick={() =>
                                      correr(() => accionResolverConflicto(v.id, 'descartar'))
                                    }
                                  >
                                    <X className="h-3.5 w-3.5" /> Dejar {mostrar(v)}
                                  </Boton>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Tarjeta>
          ))}
        </div>
      )}

      <ModalValor
        abierto={creando || !!editando}
        valor={editando}
        areas={areas}
        onCerrar={() => {
          setCreando(false);
          setEditando(null);
        }}
        onGuardar={async (id, campos) => {
          const r = await accionGuardarValor(id, campos);
          if (r.ok) {
            ok(r.mensaje);
            setCreando(false);
            setEditando(null);
          } else {
            error(r.mensaje);
          }
          return r.ok;
        }}
        onBorrar={async (id) => {
          const r = await accionBorrarValor(id);
          if (r.ok) {
            ok(r.mensaje);
            setEditando(null);
          } else {
            error(r.mensaje);
          }
        }}
      />

      <Avisos avisos={avisos} onCerrar={cerrar} />
    </div>
  );
}
