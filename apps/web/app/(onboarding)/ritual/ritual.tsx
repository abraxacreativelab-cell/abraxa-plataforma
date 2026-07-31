'use client';

import * as React from 'react';
import { Button, Icon } from '@abraxa/ui';
import { Compositor } from './componentes/compositor';
import { Conversacion, Esqueleto } from './componentes/conversacion';
import { MapaDeNegocio } from './componentes/mapa-de-negocio';
import { Progreso } from './componentes/progreso';
import { Regreso } from './componentes/regreso';
import type { Foto, RespuestaDelRitual, Turno } from './lib/tipos';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El Ritual, del lado del navegador.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Toda la verdad vive en el servidor: fase, estado del negocio y transcript
 *  son columnas de `app.onboarding_sessions`. Aquí no hay estado que pueda
 *  desincronizarse — cada respuesta del servidor PISA la vista completa, y no
 *  se parchea localmente.
 *
 *  Eso hace que cerrar la pestaña a media entrevista no pierda nada: no hay
 *  nada aquí que valiera la pena conservar. Es la contraparte de front del
 *  criterio #2.
 *
 *  Lo único optimista es la burbuja del emprendedor: se pinta antes de que el
 *  servidor conteste porque esperar 6 segundos a ver tu propio mensaje se
 *  siente roto. Si el turno falla, se retira y el texto se le devuelve.
 */
export function Ritual({ inicial }: { inicial: Foto }) {
  const [foto, setFoto] = React.useState(inicial);
  const [enVuelo, setEnVuelo] = React.useState<Turno | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const arrancado = React.useRef(false);

  const completada = foto.vista.status === 'completada';
  const bautizo = !completada && foto.vista.agente === null && foto.vista.fase === 'bienvenida';

  const llamar = React.useCallback(
    async (accion: 'iniciar' | 'turno', cuerpo?: Record<string, unknown>): Promise<void> => {
      setOcupado(true);
      setError(null);
      try {
        const r = await fetch(`/ritual/api/${accion}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(cuerpo ?? {}),
        });

        const datos = (await r.json()) as RespuestaDelRitual & {
          error?: { message: string };
        };

        if (!r.ok) throw new Error(datos.error?.message ?? 'No se pudo continuar.');

        // La vista del servidor manda, completa. Nada de parches locales.
        setFoto((previa) => ({
          ...previa,
          vista: datos.vista,
          mapa: datos.mapa ?? previa.mapa,
          transcript: [
            ...previa.transcript,
            ...(cuerpo?.texto
              ? [nuevoTurno('user', String(cuerpo.texto), datos.vista.fase)]
              : []),
            ...(datos.mensaje ? [nuevoTurno('assistant', datos.mensaje, datos.vista.fase)] : []),
          ],
          // Al primer turno propio, el bloque de regreso deja de tener sentido.
          memoria: '',
          ausencia: null,
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo continuar.');
        throw e;
      } finally {
        setEnVuelo(null);
        setOcupado(false);
      }
    },
    [],
  );

  // El primer mensaje del agente. También es el saludo de regreso cuando la
  // entrevista venía a medias: entrar a /ritual es la misma acción.
  React.useEffect(() => {
    if (arrancado.current) return;
    if (completada) return;
    if (foto.transcript.length > 0 && foto.vista.status !== 'pausada') return;
    arrancado.current = true;
    void llamar('iniciar').catch(() => {
      /* el error ya quedó en pantalla */
    });
  }, [completada, foto.transcript.length, foto.vista.status, llamar]);

  const enviar = (texto: string): void => {
    setEnVuelo(nuevoTurno('user', texto, foto.vista.fase));
    void llamar('turno', { texto }).catch(() => {
      /* la burbuja optimista ya se retiró en el finally */
    });
  };

  const pausar = (): void => {
    void fetch('/ritual/api/pausa', { method: 'POST' })
      .then((r) => r.json())
      .then((d: { vista?: Foto['vista'] }) => {
        if (d.vista) setFoto((p) => ({ ...p, vista: d.vista as Foto['vista'] }));
      })
      .catch(() => setError('No se pudo guardar la pausa. Tu avance sí está guardado.'));
  };

  const turnos = enVuelo ? [...foto.transcript, enVuelo] : foto.transcript;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-8 sm:px-8">
      <header className="sticky top-0 z-10 -mx-5 bg-[hsl(var(--background)/0.85)] px-5 py-4 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <Progreso vista={foto.vista} />
      </header>

      <main id="contenido" className="flex flex-1 flex-col gap-8">
        {foto.memoria ? <Regreso memoria={foto.memoria} ausencia={foto.ausencia} /> : null}

        {turnos.length === 0 && !completada ? (
          <Esqueleto />
        ) : (
          <Conversacion turnos={turnos} agente={foto.vista.agente} pensando={ocupado} />
        )}

        {completada && foto.mapa ? (
          <MapaDeNegocio mapa={foto.mapa} agente={foto.vista.agente} />
        ) : null}

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-[hsl(var(--color-error-border))] bg-[hsl(var(--color-error-bg))] p-4"
          >
            <Icon name="warning" className="mt-0.5 h-4 w-4 text-[hsl(var(--color-error-fg))]" />
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-[hsl(var(--color-error-fg))]">{error}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Tu avance está guardado. Nada de lo que ya contaste se perdió.
              </p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                <Icon name="refresh" className="h-3.5 w-3.5" />
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}
      </main>

      {!completada ? (
        <footer className="sticky bottom-0 -mx-5 bg-[hsl(var(--background)/0.9)] px-5 pb-6 pt-3 backdrop-blur-xl sm:-mx-8 sm:px-8">
          <Compositor
            bautizo={bautizo}
            ocupado={ocupado}
            pausada={foto.vista.status === 'pausada'}
            onEnviar={enviar}
            onPausar={pausar}
          />
        </footer>
      ) : null}
    </div>
  );
}

function nuevoTurno(role: Turno['role'], content: string, fase: Turno['fase']): Turno {
  return { role, content, at: new Date().toISOString(), fase };
}
