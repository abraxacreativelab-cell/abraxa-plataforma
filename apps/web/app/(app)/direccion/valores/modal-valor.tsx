'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { VaultRow } from '@abraxa/vault/api';
import { AreaTexto, Boton, Campo, Entrada, Modal, Selector } from '../_components/ui';
import type { AreaSimple } from './tabla-valores';

const TIPOS: Array<{ valor: string; label: string; ejemplo: string }> = [
  { valor: 'money', label: 'Monto', ejemplo: '1500' },
  { valor: 'percent', label: 'Porcentaje', ejemplo: '16' },
  { valor: 'number', label: 'Número', ejemplo: '30' },
  { valor: 'text', label: 'Texto', ejemplo: 'Lunes a viernes de 9 a 6' },
  { valor: 'date', label: 'Fecha', ejemplo: '' },
  { valor: 'bool', label: 'Sí / No', ejemplo: '' },
  { valor: 'list', label: 'Lista', ejemplo: 'Instagram, WhatsApp' },
];

interface Formulario {
  key: string;
  label: string;
  kind: string;
  numero: string;
  texto: string;
  booleano: string;
  lista: string;
  currency: string;
  unit: string;
  note: string;
  area_slug: string;
  scope_type: string;
  scope_id: string;
  active: string;
}

const VACIO: Formulario = {
  key: '',
  label: '',
  kind: 'money',
  numero: '',
  texto: '',
  booleano: 'true',
  lista: '',
  currency: 'MXN',
  unit: '',
  note: '',
  area_slug: '',
  scope_type: 'tenant',
  scope_id: '',
  active: 'true',
};

export function ModalValor({
  abierto,
  valor,
  areas,
  onCerrar,
  onGuardar,
  onBorrar,
}: {
  abierto: boolean;
  valor: VaultRow | null;
  areas: AreaSimple[];
  onCerrar: () => void;
  onGuardar: (id: string | null, campos: Record<string, unknown>) => Promise<boolean>;
  onBorrar: (id: string) => Promise<void>;
}) {
  const editando = !!valor;
  const [f, setF] = useState<Formulario>(VACIO);
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof Formulario, v: string) => setF((s) => ({ ...s, [k]: v }) as Formulario);

  useEffect(() => {
    if (!abierto) return;
    if (!valor) {
      setF(VACIO);
      return;
    }
    setF({
      key: valor.key,
      label: valor.label ?? '',
      kind: valor.kind,
      numero: valor.value != null ? String(valor.value) : '',
      texto: valor.value_text ?? '',
      booleano: valor.value_json === false ? 'false' : 'true',
      lista: Array.isArray(valor.value_json) ? (valor.value_json as unknown[]).join(', ') : '',
      currency: valor.currency ?? 'MXN',
      unit: valor.unit ?? '',
      note: valor.note ?? '',
      area_slug: valor.area_slug ?? '',
      scope_type: valor.scope_type,
      scope_id: valor.scope_id ?? '',
      active: valor.active ? 'true' : 'false',
    });
  }, [abierto, valor]);

  const numerico = f.kind === 'money' || f.kind === 'percent' || f.kind === 'number';

  function armarCuerpo(): Record<string, unknown> {
    const cuerpo: Record<string, unknown> = {
      label: f.label.trim() || f.key.replace(/_/g, ' '),
      kind: f.kind,
      unit: f.unit.trim() || null,
      note: f.note.trim() || null,
      area_slug: f.area_slug || null,
      scope_type: f.scope_type,
      active: f.active === 'true',
      value: null,
      value_text: null,
      value_json: null,
    };

    if (f.scope_type === 'area') cuerpo.scope_id = f.scope_id;

    if (numerico) {
      cuerpo.value = f.numero === '' ? null : Number(f.numero);
      if (f.kind === 'money') cuerpo.currency = f.currency.trim().toUpperCase() || 'MXN';
    } else if (f.kind === 'text' || f.kind === 'date') {
      cuerpo.value_text = f.texto.trim() || null;
    } else if (f.kind === 'bool') {
      cuerpo.value_json = f.booleano === 'true';
    } else if (f.kind === 'list') {
      cuerpo.value_json = f.lista
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // La clave no se puede cambiar al editar: renombrarla rompería en silencio
    // las plantillas y prompts que ya la usan.
    if (!editando) cuerpo.key = f.key.trim();

    return cuerpo;
  }

  async function guardar() {
    setGuardando(true);
    const listo = await onGuardar(valor?.id ?? null, armarCuerpo());
    setGuardando(false);
    if (listo) setF(VACIO);
  }

  const ejemplo = TIPOS.find((t) => t.valor === f.kind)?.ejemplo ?? '';

  return (
    <Modal
      abierto={abierto}
      titulo={editando ? `Editar · ${valor?.key}` : 'Nuevo número'}
      onCerrar={onCerrar}
      pie={
        <>
          {editando ? (
            <Boton
              variante="peligro"
              className="mr-auto"
              onClick={() => valor && onBorrar(valor.id)}
              title="Eliminar definitivamente"
            >
              <Trash2 className="h-3.5 w-3.5" /> Eliminar
            </Boton>
          ) : null}
          <Boton variante="silencioso" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" onClick={guardar} cargando={guardando}>
            {f.active === 'true' ? 'Guardar y propagar' : 'Guardar como borrador'}
          </Boton>
        </>
      }
    >
      {!editando ? (
        <Campo
          etiqueta="Clave"
          ayuda="Es el nombre corto con el que lo vas a escribir en tus plantillas: {valor.comision_pct}. Sin espacios ni acentos."
        >
          <Entrada
            value={f.key}
            autoFocus
            placeholder="comision_pct"
            onChange={(e) =>
              set(
                'key',
                e.target.value
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/[̀-ͯ]/g, '')
                  .replace(/[^a-z0-9_\s]/g, '')
                  .replace(/\s+/g, '_'),
              )
            }
          />
        </Campo>
      ) : (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          La clave <code className="text-[hsl(var(--primary))]">{valor?.key}</code> no se puede
          cambiar: hay plantillas y agentes que ya la usan.
        </p>
      )}

      <Campo etiqueta="Nombre">
        <Entrada
          value={f.label}
          onChange={(e) => set('label', e.target.value)}
          placeholder="Comisión sobre venta"
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Tipo">
          <Selector value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.label}
              </option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Área">
          <Selector value={f.area_slug} onChange={(e) => set('area_slug', e.target.value)}>
            <option value="">Sin área</option>
            {areas.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.label}
              </option>
            ))}
          </Selector>
        </Campo>
      </div>

      {numerico ? (
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta={f.kind === 'percent' ? 'Porcentaje' : f.kind === 'money' ? 'Monto' : 'Número'}>
            <Entrada
              type="number"
              step="any"
              value={f.numero}
              onChange={(e) => set('numero', e.target.value)}
              placeholder={ejemplo}
            />
          </Campo>
          {f.kind === 'money' ? (
            <Campo etiqueta="Moneda">
              <Entrada
                value={f.currency}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
                placeholder="MXN"
                maxLength={3}
              />
            </Campo>
          ) : (
            <Campo etiqueta="Unidad (opcional)">
              <Entrada
                value={f.unit}
                onChange={(e) => set('unit', e.target.value)}
                placeholder="días · horas · piezas"
              />
            </Campo>
          )}
        </div>
      ) : f.kind === 'bool' ? (
        <Campo etiqueta="Valor">
          <Selector value={f.booleano} onChange={(e) => set('booleano', e.target.value)}>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </Selector>
        </Campo>
      ) : f.kind === 'list' ? (
        <Campo etiqueta="Valores" ayuda="Sepáralos con comas.">
          <Entrada
            value={f.lista}
            onChange={(e) => set('lista', e.target.value)}
            placeholder={ejemplo}
          />
        </Campo>
      ) : (
        <Campo etiqueta="Valor">
          <Entrada
            type={f.kind === 'date' ? 'date' : 'text'}
            value={f.texto}
            onChange={(e) => set('texto', e.target.value)}
            placeholder={ejemplo}
          />
        </Campo>
      )}

      <Campo etiqueta="Nota (opcional)" ayuda="Tus agentes la leen junto con el valor.">
        <AreaTexto
          rows={2}
          value={f.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder="Ya incluye IVA · no aplica en temporada alta"
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Aplica a">
          <Selector
            value={f.scope_type}
            onChange={(e) => set('scope_type', e.target.value)}
          >
            <option value="tenant">Todo el negocio</option>
            <option value="area">Sólo un área</option>
          </Selector>
        </Campo>
        <Campo etiqueta="Estado">
          <Selector value={f.active} onChange={(e) => set('active', e.target.value)}>
            <option value="true">Vigente</option>
            <option value="false">Borrador</option>
          </Selector>
        </Campo>
      </div>

      {f.scope_type === 'area' ? (
        <Campo
          etiqueta="¿En qué área?"
          ayuda="Dentro de esa área, este valor le gana al general con la misma clave."
        >
          <Selector value={f.scope_id} onChange={(e) => set('scope_id', e.target.value)}>
            <option value="">Elige un área…</option>
            {areas.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.label}
              </option>
            ))}
          </Selector>
        </Campo>
      ) : null}
    </Modal>
  );
}
