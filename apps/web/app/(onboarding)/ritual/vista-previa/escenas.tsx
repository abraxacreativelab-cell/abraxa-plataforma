'use client';

import * as React from 'react';
import { Button, Icon } from '@abraxa/ui';
import { Compositor } from '../componentes/compositor';
import { Conversacion } from '../componentes/conversacion';
import { MapaDeNegocio } from '../componentes/mapa-de-negocio';
import { Progreso } from '../componentes/progreso';
import { Regreso } from '../componentes/regreso';
import type { Vista } from '../lib/tipos';
import { CONVERSACION, FOTO_REGRESO, MAPA, VISTA } from './guion';

/**
 * Los cuatro momentos del Ritual, con datos de ejemplo.
 *
 * Es un storyboard, no el producto: no hay motor, no hay base y no hay modelo.
 * Sirve para criticar la pantalla —el bautizo como momento, el progreso, el
 * regreso, el cierre— antes de que exista la sesión que la enciende de verdad.
 */
const ESCENAS = ['bautizo', 'entrevista', 'regreso', 'mapa'] as const;
type Escena = (typeof ESCENAS)[number];

const TITULOS: Record<Escena, string> = {
  bautizo: 'El bautizo',
  entrevista: 'La fase 4 — abogado del diablo',
  regreso: 'Vuelve al día siguiente',
  mapa: 'El cierre',
};

const VISTA_BAUTIZO: Vista = {
  ...VISTA,
  fase: 'bienvenida',
  faseIndice: 0,
  progreso: 0,
  tituloDeFase: 'El bautizo',
  agente: null,
  turnos: 1,
  faltante: ['el nombre que le pone a su agente'],
};

const VISTA_FINAL: Vista = {
  ...VISTA,
  fase: 'sintesis',
  faseIndice: 6,
  progreso: 100,
  tituloDeFase: 'Tu Mapa de Negocio',
  status: 'completada',
  faltante: [],
};

export function Escenas() {
  const [escena, setEscena] = React.useState<Escena>('bautizo');
  const nada = (): void => undefined;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-8 sm:px-8">
      <div className="flex flex-col gap-3 rounded-xl border border-[hsl(var(--color-warning-border))] bg-[hsl(var(--color-warning-bg))] p-4">
        <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-[hsl(var(--color-warning-fg))]">
          <Icon name="warning" className="h-3.5 w-3.5" />
          Vista previa · datos de ejemplo
        </p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Storyboard de la pantalla, sin motor detrás. El Ritual de verdad vive en{' '}
          <code className="text-foreground">/ritual</code> y necesita la sesión que entrega H2. Esta
          ruta no existe en producción.
        </p>
        <div className="flex flex-wrap gap-2">
          {ESCENAS.map((e) => (
            <Button
              key={e}
              size="sm"
              variant={e === escena ? 'default' : 'outline'}
              onClick={() => setEscena(e)}
            >
              {TITULOS[e]}
            </Button>
          ))}
        </div>
      </div>

      {escena === 'bautizo' ? (
        <>
          <Progreso vista={VISTA_BAUTIZO} />
          <Conversacion turnos={CONVERSACION.slice(0, 1)} agente={null} pensando={false} />
          <Compositor bautizo ocupado={false} pausada={false} onEnviar={nada} onPausar={nada} />
        </>
      ) : null}

      {escena === 'entrevista' ? (
        <>
          <Progreso vista={VISTA} />
          <Conversacion turnos={CONVERSACION} agente="Aura" pensando={false} />
          <Compositor
            bautizo={false}
            ocupado={false}
            pausada={false}
            onEnviar={nada}
            onPausar={nada}
          />
        </>
      ) : null}

      {escena === 'regreso' ? (
        <>
          <Progreso vista={VISTA} />
          <Regreso memoria={FOTO_REGRESO.memoria} ausencia={FOTO_REGRESO.ausencia} />
          <Conversacion turnos={CONVERSACION.slice(-3)} agente="Aura" pensando />
          <Compositor
            bautizo={false}
            ocupado
            pausada={false}
            onEnviar={nada}
            onPausar={nada}
          />
        </>
      ) : null}

      {escena === 'mapa' ? (
        <>
          <Progreso vista={VISTA_FINAL} />
          <MapaDeNegocio mapa={MAPA} agente="Aura" />
        </>
      ) : null}
    </div>
  );
}
