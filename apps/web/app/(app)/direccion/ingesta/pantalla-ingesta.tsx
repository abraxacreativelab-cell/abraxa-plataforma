'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ClipboardPaste,
  FileText,
  GitCompareArrows,
  Info,
  Sparkles,
} from 'lucide-react';
import type { IngestResult, VaultKind } from '@abraxa/vault/api';
import { accionAprobar, accionIngerir } from '../_lib/actions';
import {
  AreaTexto,
  Avisos,
  Boton,
  Campo,
  Entrada,
  Insignia,
  Selector,
  Tarjeta,
  useAvisos,
} from '../_components/ui';

const EJEMPLO = `# Precios 2026

- consulta_inicial: $850 — incluye diagnóstico
- seguimiento: $600
- comision_vendedor_pct: 8%

| concepto      | monto    | nota            |
|---------------|----------|-----------------|
| renta_mensual | $18,000  | local principal |
`;

/**
 * Una cifra, con SU moneda. Nunca con una asumida: el emprendedor está viendo
 * esta pantalla justo para cachar lo que salió mal, y un monto en dólares
 * pintado como pesos es exactamente lo que no podría cachar.
 */
function cifra(
  kind: VaultKind,
  value: number | null,
  value_text: string | null,
  currency: string,
): string {
  if (value == null) return value_text ?? '—';
  if (kind === 'percent') return `${value}%`;
  if (kind !== 'money') return String(value);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency || 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

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

/**
 * Pegar un documento → ver qué se encontró → aprobar uno por uno.
 *
 * El paso de aprobación es el producto, no un trámite: hasta ese clic, ningún
 * número que salió de un documento existe para nadie. Por eso la pantalla
 * enseña de dónde salió cada dato —del texto o de un modelo— antes de pedir la
 * decisión.
 */
export function PantallaIngesta({ areas }: { areas: Array<{ slug: string; label: string }> }) {
  const { avisos, ok, error, cerrar } = useAvisos();
  const { pendiente, correr } = usePendiente();

  const [contenido, setContenido] = useState('');
  const [titulo, setTitulo] = useState('');
  const [area, setArea] = useState('');
  const [resultado, setResultado] = useState<IngestResult | null>(null);
  const [aprobados, setAprobados] = useState<Set<string>>(new Set());

  function ingerir() {
    void correr(async () => {
      const r = await accionIngerir(contenido, { titulo, areaSlug: area });
      if (r.ok && r.datos) {
        setResultado(r.datos);
        setAprobados(new Set());
        ok(r.mensaje);
      } else {
        error(r.mensaje);
      }
    });
  }

  function aprobar(id: string) {
    void correr(async () => {
      const r = await accionAprobar(id);
      if (r.ok) {
        setAprobados((s) => new Set(s).add(id));
        ok(r.mensaje);
      } else {
        error(r.mensaje);
      }
    });
  }

  function aprobarTodos() {
    void correr(async () => {
      for (const v of resultado?.valores ?? []) {
        if (aprobados.has(v.id)) continue;
        const r = await accionAprobar(v.id);
        if (r.ok) setAprobados((s) => new Set(s).add(v.id));
        else error(r.mensaje);
      }
      ok('Listo. Todo lo que aprobaste ya se usa en contratos, mensajes y agentes.');
    });
  }

  const porAprobar = (resultado?.valores ?? []).filter((v) => !aprobados.has(v.id));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Agregar un documento</h2>
        <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
          Pega lo que tengas: una lista de precios, una política, un proceso, hasta un mensaje de
          WhatsApp. Lo guardo, lo hago buscable y te propongo los números que encuentre.{' '}
          <b>Nada se usa hasta que tú lo apruebes.</b>
        </p>
      </div>

      {!resultado ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-3">
            <Campo etiqueta="El documento">
              <AreaTexto
                rows={16}
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                placeholder={EJEMPLO}
                aria-label="Contenido del documento"
              />
            </Campo>

            <div className="flex flex-wrap items-center gap-2">
              <Boton
                variante="primario"
                onClick={ingerir}
                cargando={pendiente}
                disabled={!contenido.trim()}
              >
                <ClipboardPaste className="h-3.5 w-3.5" /> Guardar y revisar
              </Boton>
              {contenido ? (
                <Boton variante="silencioso" onClick={() => setContenido('')}>
                  Limpiar
                </Boton>
              ) : (
                <Boton variante="silencioso" onClick={() => setContenido(EJEMPLO)}>
                  Usar un ejemplo
                </Boton>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <Campo etiqueta="Título (opcional)" ayuda="Si no pones ninguno, lo saco del texto.">
              <Entrada
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Lista de precios 2026"
              />
            </Campo>

            <Campo etiqueta="Área (opcional)" ayuda="Si no eliges, lo clasifico yo.">
              <Selector value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">Que lo clasifique solo</option>
                {areas.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.label}
                  </option>
                ))}
              </Selector>
            </Campo>

            <Tarjeta className="space-y-2 p-3 text-xs leading-snug text-[hsl(var(--muted-foreground))]">
              <p className="flex items-center gap-1.5 font-medium text-[hsl(var(--foreground))]">
                <Info className="h-3.5 w-3.5" /> Cómo escribir los precios
              </p>
              <p>Encuentro cifras escritas así:</p>
              <code className="block whitespace-pre-wrap rounded bg-[hsl(var(--muted))]/50 p-2 text-[10px]">
                {'- costo_envio: $180 — zona metro'}
                {'\n'}
                {'| renta_mensual | $18,000 |'}
              </code>
              <p>
                Un rango («de $400 a $600») lo guardo <b>sin</b> número: no quiero convertir un
                rango en un precio por mi cuenta.
              </p>
            </Tarjeta>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Tarjeta className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="h-4 w-4 text-[hsl(var(--primary))]" />
              <span className="flex-1 text-sm font-medium">{resultado.title}</span>
              <Insignia tono="info">{resultado.areaSlug}</Insignia>
              <Insignia tono="neutro">{resultado.docType}</Insignia>
            </div>
            <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
              Guardado y partido en {resultado.indexado.total} fragmento
              {resultado.indexado.total === 1 ? '' : 's'}
              {resultado.indexado.conVector > 0
                ? `, ${resultado.indexado.conVector} ya buscable${resultado.indexado.conVector === 1 ? '' : 's'} por significado`
                : ''}
              . Clasificado por: {resultado.clasificadoPor === 'ninguno' ? 'reglas de texto' : resultado.clasificadoPor}.
            </p>

            {resultado.avisos.length > 0 ? (
              <ul className="mt-3 space-y-1 border-t border-[hsl(var(--border))] pt-3">
                {resultado.avisos.map((a) => (
                  <li
                    key={a}
                    className="flex items-start gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"
                  >
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    {a}
                  </li>
                ))}
              </ul>
            ) : null}
          </Tarjeta>

          {/*
            Lo que este documento CONTRADICE. Va antes de las propuestas a
            propósito: una cifra vigente que el documento nuevo desmiente es
            más urgente que una cifra nueva que nadie ha usado todavía.
          */}
          {resultado.conflictos.length > 0 ? (
            <section className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <GitCompareArrows className="h-4 w-4 text-rose-400" />
                  Este documento contradice {resultado.conflictos.length} número
                  {resultado.conflictos.length === 1 ? '' : 's'} que ya habías aprobado
                </h3>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                No cambié ninguno. Lo que aprobaste sigue vigente y se sigue usando en tus
                contratos y agentes hasta que tú decidas.
              </p>

              <div className="space-y-2">
                {resultado.conflictos.map((c) => (
                  <Tarjeta
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 border-rose-500/25 bg-rose-500/[0.04] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <code className="text-[11px] text-[hsl(var(--primary))]">{c.key}</code>
                      <span className="ml-2 truncate text-sm">{c.label}</span>
                    </div>
                    <span className="whitespace-nowrap text-xs text-[hsl(var(--muted-foreground))]">
                      tú aprobaste{' '}
                      <b className="tabular-nums text-[hsl(var(--foreground))]">
                        {cifra(c.kind, c.vigente.value, c.vigente.value_text, c.vigente.currency)}
                      </b>
                      {' · '}el documento dice{' '}
                      <b className="tabular-nums text-[hsl(var(--foreground))]">
                        {cifra(c.kind, c.propuesto.value, c.propuesto.value_text, c.propuesto.currency)}
                      </b>
                    </span>
                  </Tarjeta>
                ))}
              </div>

              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Decide cuál se queda en{' '}
                <Link
                  href="/direccion/valores?estado=conflicto"
                  className="text-[hsl(var(--primary))] underline"
                >
                  la lista de números
                </Link>
                .
              </p>
            </section>
          ) : null}

          {resultado.valores.length > 0 ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Encontré {resultado.valores.length} dato
                  {resultado.valores.length === 1 ? '' : 's'}. ¿Cuáles son correctos?
                </h3>
                {porAprobar.length > 1 ? (
                  <Boton variante="contorno" onClick={aprobarTodos} cargando={pendiente}>
                    Aprobar los {porAprobar.length}
                  </Boton>
                ) : null}
              </div>

              <div className="space-y-2">
                {resultado.valores.map((v) => {
                  const listo = aprobados.has(v.id);
                  return (
                    <Tarjeta
                      key={v.id}
                      className={`flex flex-wrap items-center gap-3 p-3 ${
                        listo ? 'border-emerald-500/25 bg-emerald-500/[0.04]' : 'bg-amber-500/[0.04]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-[11px] text-[hsl(var(--primary))]">{v.key}</code>
                          <span className="truncate text-sm">{v.label}</span>
                          {v.origen === 'modelo' ? (
                            <Insignia tono="info" title="Lo dedujo un modelo, no salió literal del texto">
                              <Sparkles className="h-2.5 w-2.5" /> deducido
                            </Insignia>
                          ) : (
                            <Insignia tono="neutro" title="Salió literal del texto que pegaste">
                              del texto
                            </Insignia>
                          )}
                        </div>
                        {v.note ? (
                          <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                            {v.note}
                          </p>
                        ) : null}
                      </div>

                      <span className="whitespace-nowrap font-medium tabular-nums">
                        {cifra(v.kind, v.value, v.value_text, v.currency)}
                      </span>

                      {listo ? (
                        <Insignia tono="activo">
                          <CheckCircle2 className="h-2.5 w-2.5" /> ya se usa
                        </Insignia>
                      ) : (
                        <Boton
                          variante="contorno"
                          onClick={() => aprobar(v.id)}
                          disabled={pendiente}
                          className="text-[hsl(var(--primary))]"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Es correcto
                        </Boton>
                      )}
                    </Tarjeta>
                  );
                })}
              </div>

              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Los que no apruebes se quedan guardados como borrador. Puedes revisarlos después en{' '}
                <Link href="/direccion/valores" className="text-[hsl(var(--primary))] underline">
                  la lista de números
                </Link>
                .
              </p>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Boton
              variante="contorno"
              onClick={() => {
                setResultado(null);
                setContenido('');
                setTitulo('');
              }}
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> Agregar otro documento
            </Boton>
            <Link
              href={`/direccion/biblioteca/${resultado.documentId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--muted))]"
            >
              <FileText className="h-3.5 w-3.5" /> Ver el documento
            </Link>
          </div>
        </div>
      )}

      <Avisos avisos={avisos} onCerrar={cerrar} />
    </div>
  );
}
