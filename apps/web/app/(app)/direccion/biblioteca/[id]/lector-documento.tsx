'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Archive, Eye, History, Layers, Pencil, Save } from 'lucide-react';
// `@abraxa/vault/copy` y no `/api`: esto es un componente de CLIENTE y el
// barril de la bóveda arrastra `node:crypto` al bundle del navegador.
import { etiquetaDocType } from '@abraxa/vault/copy';
import type { DocType, DocumentRow, VaultRow } from '@abraxa/vault/api';
import { accionArchivarDocumento, accionGuardarDocumento } from '../../_lib/actions';
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
} from '../../_components/ui';

interface Version {
  version: number;
  title: string;
  created_by: string | null;
  created_at: string;
}

const TIPOS: DocType[] = [
  'sop',
  'contrato',
  'precios',
  'guion',
  'politica',
  'manual',
  'faq',
  'plantilla',
  'otro',
];

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

export function LectorDocumento({
  documento,
  versiones,
  derivados,
  areas,
  puedeEditar,
}: {
  documento: DocumentRow;
  versiones: Version[];
  derivados: VaultRow[];
  areas: Array<{ slug: string; label: string }>;
  puedeEditar: boolean;
}) {
  const { avisos, ok, error, cerrar } = useAvisos();
  const { pendiente, correr } = usePendiente();

  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(documento.title);
  const [contenido, setContenido] = useState(documento.content);
  const [area, setArea] = useState(documento.area_slug ?? '');
  const [tipo, setTipo] = useState<DocType>(documento.doc_type);

  function guardar() {
    void correr(async () => {
      const r = await accionGuardarDocumento(documento.id, {
        title: titulo,
        content: contenido,
        areaSlug: area || null,
        docType: tipo,
      });
      if (r.ok) {
        ok(r.mensaje);
        setEditando(false);
      } else {
        error(r.mensaje);
      }
    });
  }

  function archivar() {
    void correr(async () => {
      const r = await accionArchivarDocumento(documento.id);
      if (r.ok) ok(r.mensaje);
      else error(r.mensaje);
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-3">
        <Tarjeta className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{documento.title}</span>
            <Insignia tono="neutro">{etiquetaDocType(documento.doc_type)}</Insignia>
            {documento.status === 'draft' ? <Insignia tono="borrador">borrador</Insignia> : null}
            {documento.status === 'archived' ? (
              <Insignia tono="alerta">archivado</Insignia>
            ) : null}
            <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
              v{documento.version}
            </span>
          </div>

          {editando ? (
            <div className="space-y-3 p-4">
              <Campo etiqueta="Título">
                <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Área">
                  <Selector value={area} onChange={(e) => setArea(e.target.value)}>
                    <option value="">Sin área</option>
                    {areas.map((a) => (
                      <option key={a.slug} value={a.slug}>
                        {a.label}
                      </option>
                    ))}
                  </Selector>
                </Campo>
                <Campo etiqueta="Tipo">
                  <Selector value={tipo} onChange={(e) => setTipo(e.target.value as DocType)}>
                    {TIPOS.map((t) => (
                      <option key={t} value={t}>
                        {etiquetaDocType(t)}
                      </option>
                    ))}
                  </Selector>
                </Campo>
              </div>
              <Campo
                etiqueta="Contenido"
                ayuda="Al guardar, la versión anterior queda en el historial y el documento se vuelve a indexar."
              >
                <AreaTexto
                  rows={22}
                  value={contenido}
                  onChange={(e) => setContenido(e.target.value)}
                />
              </Campo>
            </div>
          ) : (
            <article className="prose prose-sm prose-invert max-w-none px-5 py-5">
              <ReactMarkdown>{documento.content}</ReactMarkdown>
            </article>
          )}
        </Tarjeta>

        {puedeEditar ? (
          <div className="flex flex-wrap gap-2">
            {editando ? (
              <>
                <Boton variante="primario" onClick={guardar} cargando={pendiente}>
                  <Save className="h-3.5 w-3.5" /> Guardar cambios
                </Boton>
                <Boton
                  variante="silencioso"
                  onClick={() => {
                    setEditando(false);
                    setTitulo(documento.title);
                    setContenido(documento.content);
                  }}
                >
                  Cancelar
                </Boton>
              </>
            ) : (
              <>
                <Boton variante="contorno" onClick={() => setEditando(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Boton>
                {documento.status !== 'archived' ? (
                  <Boton variante="silencioso" onClick={archivar} cargando={pendiente}>
                    <Archive className="h-3.5 w-3.5" /> Archivar
                  </Boton>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <aside className="space-y-3">
        <Tarjeta className="p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <Layers className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
            Números que salieron de aquí
          </h3>
          {derivados.length === 0 ? (
            <p className="mt-2 text-xs leading-snug text-[hsl(var(--muted-foreground))]">
              Ninguno todavía. Si este documento tiene precios, escríbelos como{' '}
              <code className="text-[10px]">- concepto: $1,500</code> y vuelve a agregarlo.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {derivados.map((v) => (
                <li key={v.id} className="flex items-baseline gap-2 text-xs">
                  <code className="text-[10px] text-[hsl(var(--primary))]">{v.key}</code>
                  <span className="flex-1 truncate text-[hsl(var(--muted-foreground))]">
                    {v.label}
                  </span>
                  {v.active ? (
                    <Insignia tono="activo">vigente</Insignia>
                  ) : (
                    <Insignia tono="borrador">por revisar</Insignia>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-[hsl(var(--border))] pt-2 text-[10px] leading-snug text-[hsl(var(--muted-foreground))]/70">
            Este documento es la fuente. Los números de arriba son una copia que se puede volver a
            calcular; el documento no.
          </p>
        </Tarjeta>

        <Tarjeta className="p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <History className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
            Historial
          </h3>
          {versiones.length === 0 ? (
            <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
              Sin ediciones todavía.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {versiones.map((v) => (
                <li key={v.version} className="flex items-baseline gap-2 text-xs">
                  <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                    v{v.version}
                  </span>
                  <span className="flex-1 truncate">{v.title}</span>
                  <Eye className="h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))]/50" />
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </aside>

      <Avisos avisos={avisos} onCerrar={cerrar} />
    </div>
  );
}
