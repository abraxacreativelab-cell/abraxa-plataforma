'use client';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  /automatizaciones — describirlo en español, verlo, editarlo, verlo correr.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Tres columnas: los flujos, el lienzo, y el paso seleccionado. Abajo del
 *  lienzo, el panel en vivo cuando hay una corrida que mirar.
 *
 *  Dos cosas que esta pantalla NO se permite:
 *
 *   · **Prometer un paso que el motor no corra.** La paleta sale de
 *     `CATALOGO`, la misma lista que ejecuta el worker.
 *   · **Encender un flujo sin decirlo.** Activar abre una confirmación que
 *     avisa, con esas palabras, que va a ejecutarse con contactos REALES; y si
 *     el rol no alcanza, el botón se deshabilita CON su explicación en vez de
 *     soltar un 403 sorpresa después de armar el flujo completo.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Flow, FlowRun, FlowVersion, RunSnapshot, StepStatus } from '@abraxa/flows/ui';
import { CATALOGO, DISPARADORES, definicionDe } from '@abraxa/flows/ui';
import { Lienzo } from './lienzo';
import type { EstadosDePaso } from './lienzo';
import { PanelDeCorrida } from './panel-de-corrida';
import { seguirCorrida } from './transporte';
import * as datos from './datos';

type Estado = 'cargando' | 'listo' | 'sin-cablear' | 'error';

export interface PantallaProps {
  /** `true` si quien mira puede activar y probar. Lo decide el servidor. */
  puedeActivar: boolean;
}

const vacio = (): Flow['definition'] => ({
  nodes: [{ id: 'inicio', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Cuando pase esto' } }],
  edges: [],
});

export function Pantalla({ puedeActivar }: PantallaProps) {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [motivo, setMotivo] = useState('');
  const [flujos, setFlujos] = useState<Flow[]>([]);
  const [activo, setActivo] = useState<Flow | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [corridas, setCorridas] = useState<FlowRun[]>([]);
  const [viendo, setViendo] = useState<string | null>(null);
  const [versiones, setVersiones] = useState<FlowVersion[]>([]);
  const [descripcion, setDescripcion] = useState('');
  const [pensando, setPensando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [estadosDePaso, setEstadosDePaso] = useState<EstadosDePaso>({});

  // ── Carga ────────────────────────────────────────────────────────────────
  const recargar = useCallback(async () => {
    const r = await datos.cargarFlujos();
    if (r.estado === 'sin-cablear') {
      setEstado('sin-cablear');
      setMotivo(r.motivo);
      return;
    }
    if (r.estado === 'error') {
      setEstado('error');
      setMotivo(r.mensaje);
      return;
    }
    setFlujos(r.datos);
    setActivo((previo) => previo ?? r.datos[0] ?? null);
    setEstado('listo');
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => {
    if (!activo) return;
    void datos.cargarCorridas(activo.id).then((r) => {
      if (r.estado === 'datos') setCorridas(r.datos);
    });
    void datos.cargarVersiones(activo.id).then((r) => {
      if (r.estado === 'datos') setVersiones(r.datos);
    });
  }, [activo]);

  // ── Acciones ─────────────────────────────────────────────────────────────
  const propuestaDe = (f: Flow): unknown => ({
    name: f.name,
    description: f.description,
    trigger_type: f.triggerType,
    trigger_config: f.triggerConfig,
    definition: f.definition,
  });

  async function guardar(f: Flow): Promise<void> {
    setErrores([]);
    const r = await datos.guardarFlujo(f.id, propuestaDe(f));
    if (r.estado === 'datos') {
      setActivo(r.datos);
      setAviso(`Guardado. Ahora es la versión ${r.datos.version}.`);
      void recargar();
    } else if (r.estado === 'error') {
      setErrores(r.mensaje.split('\n'));
    }
  }

  async function pedirAsistente(): Promise<void> {
    if (!descripcion.trim()) return;
    setPensando(true);
    setErrores([]);
    const r = await datos.pedirPropuesta(descripcion);
    setPensando(false);

    if (r.estado !== 'datos') {
      setErrores([r.estado === 'error' ? r.mensaje : r.motivo]);
      return;
    }
    const creado = await datos.crearFlujo(r.datos.propuesta);
    if (creado.estado === 'datos') {
      setActivo(creado.datos);
      setDescripcion('');
      setAviso(
        r.datos.notas
          ? `Listo, y quedó EN PAUSA. Nota del asistente: ${r.datos.notas}`
          : 'Listo, y quedó EN PAUSA. Revísalo y actívalo tú.',
      );
      void recargar();
    } else if (creado.estado === 'error') {
      setErrores(creado.mensaje.split('\n'));
    }
  }

  async function activar(): Promise<void> {
    if (!activo) return;
    setConfirmando(false);
    const r = await datos.activarFlujo(activo.id);
    if (r.estado === 'datos') {
      setActivo(r.datos);
      setAviso('Encendido. A partir de ahora corre solo.');
      void recargar();
    } else if (r.estado === 'error') {
      setErrores(r.mensaje.split('\n'));
    }
  }

  async function pausar(): Promise<void> {
    if (!activo) return;
    const r = await datos.pausarFlujo(activo.id);
    if (r.estado === 'datos') {
      setActivo(r.datos);
      setAviso('Apagado.');
      void recargar();
    }
  }

  async function probar(): Promise<void> {
    if (!activo) return;
    setErrores([]);
    const r = await datos.probarFlujo(activo.id);
    if (r.estado === 'datos') {
      if (r.datos.corridas === 0) {
        setAviso(r.datos.razon ?? 'No se enroló nadie.');
        return;
      }
      const lista = await datos.cargarCorridas(activo.id);
      if (lista.estado === 'datos') {
        setCorridas(lista.datos);
        const ultima = lista.datos[0];
        if (ultima) setViendo(ultima.id);
      }
    } else if (r.estado === 'error') {
      setErrores(r.mensaje.split('\n'));
    }
  }

  async function restaurar(version: number): Promise<void> {
    if (!activo) return;
    const r = await datos.restaurarVersion(activo.id, version);
    if (r.estado === 'datos') {
      setActivo(r.datos);
      setAviso(`Volviste a la versión ${version}. Quedó guardada como la ${r.datos.version}.`);
      void recargar();
    } else if (r.estado === 'error') {
      setErrores(r.mensaje.split('\n'));
    }
  }

  /** El lienzo se pinta con lo que llega del panel en vivo. */
  const alRecibirFoto = useCallback((foto: RunSnapshot) => {
    const mapa: EstadosDePaso = {};
    for (const p of foto.steps) mapa[p.nodeId] = p.status as StepStatus;
    if (foto.run.currentNode && (foto.run.status === 'running' || foto.run.status === 'waiting')) {
      mapa[foto.run.currentNode] = 'corriendo';
    }
    setEstadosDePaso(mapa);
  }, []);

  /**
   * El mismo transporte, con una derivación: el lienzo se enciende con la
   * MISMA foto que pinta el panel. Sigue siendo una sola función de
   * transporte — aquí sólo se le engancha un segundo lector.
   */
  const seguirYPintar = useCallback<typeof seguirCorrida>(
    (runId, alRecibir, alFallar) =>
      seguirCorrida(
        runId,
        (f) => {
          alRecibirFoto(f);
          alRecibir(f);
        },
        alFallar,
      ),
    [alRecibirFoto],
  );

  // ── Pintado ──────────────────────────────────────────────────────────────
  if (estado === 'cargando') {
    return <p className="text-sm text-muted-foreground">Cargando tus automatizaciones…</p>;
  }

  if (estado === 'sin-cablear') {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/30 p-6">
        <h2 className="text-sm font-medium">Todavía no hay sesión que verificar</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{motivo}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          La pantalla no se inventa un usuario ni lee la empresa de una cabecera del navegador: es
          justo así como se cuela un agujero de aislamiento.
        </p>
      </div>
    );
  }

  if (estado === 'error') {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        {motivo}
      </div>
    );
  }

  const nodoSeleccionado = activo?.definition.nodes.find((n) => n.id === seleccion) ?? null;
  const defSeleccionada = nodoSeleccionado ? definicionDe(nodoSeleccionado.type) : null;

  return (
    <div className="space-y-6">
      {/* ── El asistente ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card/40 p-4">
        <label htmlFor="describir" className="text-sm font-medium">
          Describe en español lo que quieres que pase solo
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="describir"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Cuando entre un lead por mi página, mándale un mensaje y métemelo en Contactado"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void pedirAsistente()}
            disabled={pensando || !descripcion.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pensando ? 'Armándolo…' : 'Armarlo'}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Lo que se arme se guarda <strong>en pausa</strong>. Encenderlo es tu decisión, aparte.
        </p>
      </section>

      {aviso && (
        <p className="rounded-md border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          {aviso}
        </p>
      )}
      {errores.length > 0 && (
        <ul className="space-y-1 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr_280px]">
        {/* ── Los flujos ─────────────────────────────────────────────── */}
        <aside className="space-y-1">
          {flujos.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Todavía no tienes ninguna. Descríbela arriba.
            </p>
          )}
          {flujos.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setActivo(f);
                setViendo(null);
                setEstadosDePaso({});
              }}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                activo?.id === f.id ? 'border-primary bg-card' : 'border-border bg-card/30'
              }`}
            >
              <span className="block truncate">{f.name}</span>
              <span
                className={`text-[11px] ${
                  f.status === 'active' ? 'text-emerald-400' : 'text-muted-foreground'
                }`}
              >
                {f.status === 'active' ? 'encendida' : 'en pausa'} · v{f.version}
              </span>
            </button>
          ))}
        </aside>

        {/* ── El lienzo ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          {activo ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-lg font-medium">{activo.name}</h2>

                {activo.status === 'active' ? (
                  <button
                    type="button"
                    onClick={() => void pausar()}
                    className="rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    Apagar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmando(true)}
                    disabled={!puedeActivar}
                    title={
                      puedeActivar
                        ? undefined
                        : 'Encender una automatización exige rol admin: va a actuar sobre contactos reales.'
                    }
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Encender
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void probar()}
                  disabled={!puedeActivar}
                  title={puedeActivar ? undefined : 'Probar exige rol admin.'}
                  className="rounded-md border border-border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Probar
                </button>
                <button
                  type="button"
                  onClick={() => void guardar(activo)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  Guardar
                </button>
              </div>

              {!puedeActivar && (
                <p className="text-xs text-muted-foreground">
                  Puedes editar y guardar. Encender y probar exigen rol admin, porque desde ese
                  momento la automatización le escribe a contactos reales.
                </p>
              )}

              <Lienzo
                definicion={activo.definition}
                estados={estadosDePaso}
                seleccionado={seleccion}
                alSeleccionar={setSeleccion}
                alMover={(id, position) =>
                  setActivo({
                    ...activo,
                    definition: {
                      ...activo.definition,
                      nodes: activo.definition.nodes.map((n) =>
                        n.id === id ? { ...n, position } : n,
                      ),
                    },
                  })
                }
              />

              {viendo && (
                <PanelDeCorrida
                  runId={viendo}
                  seguir={seguirYPintar}
                  alCerrar={() => {
                    setViendo(null);
                    setEstadosDePaso({});
                  }}
                />
              )}

              {corridas.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-medium">Corridas</h3>
                  <ul className="space-y-1">
                    {corridas.slice(0, 8).map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setViendo(c.id)}
                          className="w-full rounded border border-border bg-card/30 px-3 py-1.5 text-left text-xs"
                        >
                          <span className="mr-2 text-muted-foreground">
                            {new Date(c.startedAt).toLocaleString('es-MX')}
                          </span>
                          {c.status}
                          {c.isTest && <span className="ml-2 text-amber-300">prueba</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Describe arriba lo que quieres que pase solo y aparecerá aquí.
            </div>
          )}
        </div>

        {/* ── El paso seleccionado ───────────────────────────────────── */}
        <aside className="space-y-3">
          {nodoSeleccionado && defSeleccionada && activo ? (
            <div className="rounded-lg border border-border bg-card/40 p-3">
              <h3 className="text-sm font-medium">{defSeleccionada.etiqueta}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{defSeleccionada.resumen}</p>

              <div className="mt-3 space-y-3">
                {defSeleccionada.campos.map((campo) => {
                  const config = (nodoSeleccionado.data?.config ?? {}) as Record<string, unknown>;
                  const valor = config[campo.clave] ?? '';
                  const cambiar = (v: string): void =>
                    setActivo({
                      ...activo,
                      definition: {
                        ...activo.definition,
                        nodes: activo.definition.nodes.map((n) =>
                          n.id === nodoSeleccionado.id
                            ? { ...n, data: { ...n.data, config: { ...config, [campo.clave]: v } } }
                            : n,
                        ),
                      },
                    });

                  return (
                    <div key={campo.clave}>
                      <label
                        htmlFor={`campo-${campo.clave}`}
                        className="block text-xs font-medium text-muted-foreground"
                      >
                        {campo.etiqueta}
                        {campo.requerido && <span className="text-red-400"> *</span>}
                      </label>

                      {campo.tipo === 'opcion' ? (
                        <select
                          id={`campo-${campo.clave}`}
                          value={String(valor)}
                          onChange={(e) => cambiar(e.target.value)}
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                        >
                          <option value="">—</option>
                          {campo.opciones?.map((o) => (
                            <option key={o.valor} value={o.valor}>
                              {o.etiqueta}
                            </option>
                          ))}
                        </select>
                      ) : campo.tipo === 'texto-largo' ? (
                        <textarea
                          id={`campo-${campo.clave}`}
                          value={String(valor)}
                          onChange={(e) => cambiar(e.target.value)}
                          rows={4}
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                        />
                      ) : (
                        <input
                          id={`campo-${campo.clave}`}
                          type={campo.tipo === 'numero' ? 'number' : 'text'}
                          value={String(valor)}
                          onChange={(e) => cambiar(e.target.value)}
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                        />
                      )}

                      {campo.ayuda && (
                        <p className="mt-1 text-[11px] text-muted-foreground">{campo.ayuda}</p>
                      )}
                    </div>
                  );
                })}
                {defSeleccionada.campos.length === 0 && (
                  <p className="text-xs text-muted-foreground">Este paso no se configura.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card/40 p-3">
              <h3 className="text-sm font-medium">Los pasos que puedes usar</h3>
              <ul className="mt-2 space-y-1.5">
                {CATALOGO.filter((n) => n.tipo !== 'trigger').map((n) => (
                  <li key={n.tipo} className="text-xs">
                    <span className="text-foreground">{n.etiqueta}</span>
                    <span className="block text-muted-foreground">{n.resumen}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Son todos los que el motor ejecuta de verdad. No hay ninguno más, y no hay ninguno
                aquí que no corra.
              </p>
            </div>
          )}

          {activo && versiones.length > 1 && (
            <div className="rounded-lg border border-border bg-card/40 p-3">
              <h3 className="text-sm font-medium">Versiones</h3>
              <ul className="mt-2 space-y-1">
                {versiones.slice(0, 6).map((v) => (
                  <li key={v.version} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">
                      v{v.version} · {v.note ?? 'sin nota'}
                    </span>
                    {v.version !== activo.version && puedeActivar && (
                      <button
                        type="button"
                        onClick={() => void restaurar(v.version)}
                        className="shrink-0 underline underline-offset-2"
                      >
                        volver
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card/40 p-3">
            <h3 className="text-sm font-medium">Disparadores</h3>
            <ul className="mt-2 space-y-1.5">
              {DISPARADORES.map((d) => (
                <li key={d.tipo} className="text-xs">
                  <span className={d.emitidoPor ? 'text-foreground' : 'text-muted-foreground'}>
                    {d.etiqueta}
                  </span>
                  {!d.emitidoPor && (
                    <span className="block text-[11px] text-amber-400/80">
                      todavía nadie lo dispara
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      {/* ── La confirmación de encender ───────────────────────────────── */}
      {confirmando && activo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-5">
            <h2 className="text-base font-medium">¿Encender «{activo.name}»?</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              A partir de este momento va a ejecutarse con tus contactos{' '}
              <strong className="text-foreground">reales</strong>: les va a escribir, moverlos de
              etapa y crear tareas por su cuenta, sin volver a preguntarte.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Puedes apagarlo cuando quieras, pero lo que ya haya mandado no se puede deshacer.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                Todavía no
              </button>
              <button
                type="button"
                onClick={() => void activar()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              >
                Sí, encenderlo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { vacio as definicionVacia };
