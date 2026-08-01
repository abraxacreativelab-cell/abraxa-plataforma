'use client';

import * as React from 'react';
import { Button, Icon } from '@abraxa/ui';
import { Compositor } from './componentes/compositor';
import { Conversacion, Esqueleto } from './componentes/conversacion';
import { InterruptorDeVoz } from './componentes/interruptor-de-voz';
import { MapaDeNegocio } from './componentes/mapa-de-negocio';
import { Progreso } from './componentes/progreso';
import { Regreso } from './componentes/regreso';
import { Sitio } from './componentes/sitio';
import { useVozDelRitual } from './lib/voz-del-ritual';
import type {
  Foto,
  LecturaDelSitio,
  PropuestaDelSitio,
  RespuestaDelRitual,
  Turno,
} from './lib/tipos';

/**
 * A dónde lleva "guardar y seguir después".
 *
 * ── Por qué `/mapa` y no `/panel` ─────────────────────────────────────────
 *
 * El encargo dice `/panel`. En `main` (8591c35) esa ruta NO existe: lo que H11
 * entregó en el PR #21 es `/mapa`, y es exactamente la pantalla que describe el
 * encargo — las áreas abiertas primero, las bloqueadas al final con candado, su
 * promesa y qué falta para abrirlas. Mandar a `/panel` sería mandar a un 404 en
 * el momento en que el invitado por fin ve lo que ganó, que es el peor lugar
 * posible para un 404.
 *
 * El día que exista `/panel`, esto es una línea. Está aquí arriba y con nombre
 * propio para que sea esa línea y no una búsqueda.
 */
const EL_PANEL = '/mapa';

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
 *
 *  Esa segunda mitad —devolverle el texto— era sólo una promesa de este
 *  comentario hasta la auditoría del PR #8: `enviar` se tragaba el error y el
 *  compositor ya se había vaciado. Ahora `enviar` devuelve si el turno llegó, y
 *  el compositor restaura lo que la persona escribió. Ver `compositor.tsx`.
 *
 *  ── Y no se reenvía a ciegas (segunda auditoría del PR #8) ────────────────
 *
 *  El BFF corta a los 90 s, y su abort NO cancela nada del otro lado: la API
 *  termina su corrida y escribe el turno cinco segundos después. La pantalla,
 *  mientras tanto, decía «vuelve a mandar tu mensaje: no se perdió nada» y
 *  devolvía el texto al compositor — o sea que el producto pedía la segunda
 *  petición que duplicaba la frase de la persona, y que si el turno abortado
 *  era el que cerraba la fase 5, disparaba la fase 6 por segunda vez.
 *
 *  Un 504 ya no significa "no llegó". Significa "no sé", y lo único honesto es
 *  ir a preguntar: se relee `GET /ritual` y se comparan los turnos contra los
 *  que había antes de mandar. Si avanzó, el mensaje SÍ entró y no hay nada que
 *  reenviar. Si no avanzó, se le devuelve el texto — y con el mismo id de
 *  envío, para que si las dos peticiones acaban entrando, la API reconozca la
 *  segunda como lo que es.
 */

/** El BFF se rindió esperando a la API. No dice si el turno entró o no. */
class SeTardo extends Error {}

/** La API contestó que alguien más movió el Ritual mientras tanto. */
class SeAdelantaron extends Error {}

/**
 * Un id por ENVÍO.
 *
 * `crypto.randomUUID` no existe fuera de un contexto seguro —http en una IP de
 * la red local, que es como se prueba esto en el Smart Lab—, así que hay
 * respaldo. No tiene que ser criptográfico: sólo distinto para cada mensaje.
 */
function nuevoEnvio(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;

  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function Ritual({ inicial }: { inicial: Foto }) {
  const [foto, setFoto] = React.useState(inicial);
  const [enVuelo, setEnVuelo] = React.useState<Turno | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * Un canal aparte del error, y no un lujo.
   *
   * «Tu mensaje sí entró» y «tu mapa se está armando» son buenas noticias. Con
   * un solo canal salían en el recuadro rojo de fallo, debajo de un icono de
   * advertencia — o sea que el arreglo del 504 le habría dicho a la persona que
   * algo salió mal justo cuando nada salió mal.
   */
  const [aviso, setAviso] = React.useState<string | null>(null);
  const arrancado = React.useRef(false);

  /**
   * El envío que todavía no aterriza.
   *
   * Sobrevive al fallo a propósito: mientras el mismo texto siga sin entrar,
   * reintentarlo tiene que llevar el MISMO id. Si cambiara en cada intento, la
   * API no tendría con qué distinguir un reenvío de un mensaje nuevo — que es
   * exactamente el agujero que este id viene a tapar.
   */
  const envio = React.useRef<{ texto: string; id: string } | null>(null);

  const completada = foto.vista.status === 'completada';
  const cerrando = foto.vista.status === 'cerrando';
  const bautizo = !completada && foto.vista.agente === null && foto.vista.fase === 'bienvenida';

  /**
   * La voz. Toda su lógica vive en el hook; aquí sólo se decide cuándo hablar.
   *
   * El contexto sesga el vocabulario del dictado hacia lo que esta persona va a
   * decir: el nombre que le puso a su agente y las palabras de su giro. Sin él,
   * Whisper convierte "Cariñeeto" en "cariñito" con toda seguridad.
   */
  const voz = useVozDelRitual({
    contexto: [foto.vista.agente, foto.vista.tituloDeFase].filter(Boolean).join(', '),
  });

  /**
   * Ofrecer leer su página: sólo al principio, y sólo una vez.
   *
   * `sitioResuelto` es un estado que sólo va en una dirección. Un atajo que
   * vuelve a aparecer después de que lo omitiste deja de ser un atajo y se
   * vuelve una distracción — y para entonces lo que se sacaría de la página ya
   * lo dijo él, mejor.
   *
   * La condición es la más temprana posible: bautizado y todavía sin contestar
   * la primera pregunta. Justo el momento en que ahorrarse preguntas vale más.
   */
  const [sitioResuelto, setSitioResuelto] = React.useState(false);
  const ofrecerSitio =
    !sitioResuelto &&
    !completada &&
    !cerrando &&
    !bautizo &&
    foto.vista.fase === 'identidad' &&
    foto.vista.ayuda?.clave === 'categoria';

  const llamar = React.useCallback(
    async (accion: 'iniciar' | 'turno', cuerpo?: Record<string, unknown>): Promise<void> => {
      setOcupado(true);
      setError(null);
      setAviso(null);
      try {
        const r = await fetch(`/ritual/api/${accion}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(cuerpo ?? {}),
        });

        const datos = (await r.json()) as RespuestaDelRitual & {
          error?: { message: string };
        };

        if (!r.ok) {
          const dicho = datos.error?.message ?? 'No se pudo continuar.';
          if (r.status === 504) throw new SeTardo(dicho);
          if (r.status === 409) throw new SeAdelantaron(dicho);
          throw new Error(dicho);
        }

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
    if (completada || cerrando) return;
    if (foto.transcript.length > 0 && foto.vista.status !== 'pausada') return;
    arrancado.current = true;
    void llamar('iniciar').catch(() => {
      /* el error ya quedó en pantalla */
    });
  }, [cerrando, completada, foto.transcript.length, foto.vista.status, llamar]);

  /** Relee el Ritual del servidor. Es la única fuente de verdad que hay. */
  const releer = React.useCallback(async (): Promise<Foto | null> => {
    try {
      const r = await fetch('/ritual/api/estado', { cache: 'no-store' });
      if (!r.ok) return null;
      const fresca = (await r.json()) as Foto;
      setFoto(fresca);
      return fresca;
    } catch {
      return null;
    }
  }, []);

  /**
   * Mientras el Ritual se cierra no hay nada que teclear: se espera y ya.
   *
   * La fase 6 tarda entre 5 y 30 segundos y termina sola. Quien llegue aquí es
   * alguien cuya petición se topó con un cierre en curso —otra pestaña, o su
   * propio reenvío— y lo que necesita no es un botón: es que la pantalla se
   * entere cuando el mapa esté.
   */
  const esperando = React.useRef(false);

  const esperarElMapa = React.useCallback(async (): Promise<void> => {
    if (esperando.current) return;
    esperando.current = true;
    try {
      for (let intento = 0; intento < 30; intento++) {
        await new Promise((listo) => setTimeout(listo, 2000));
        const f = await releer();
        if (f && f.vista.status !== 'cerrando') {
          // Ya está el mapa: se retira el aviso de "espérate tantito", que ya
          // no describe nada.
          if (f.vista.status === 'completada') {
            setError(null);
            setAviso(null);
          }
          return;
        }
      }
    } finally {
      esperando.current = false;
    }
  }, [releer]);

  // Recargar la página a media fase 6 tiene que terminar en el mapa, no en una
  // pantalla congelada esperando un turno que ya nadie va a mandar.
  React.useEffect(() => {
    if (cerrando) void esperarElMapa();
  }, [cerrando, esperarElMapa]);

  /**
   * Manda el turno y dice si llegó.
   *
   * El `false` no es cosmético: es lo que le permite al compositor devolverle
   * al emprendedor el párrafo que acababa de escribir. La burbuja optimista ya
   * se retiró en el `finally` de `llamar`, y el error ya está en pantalla.
   *
   * El `true` del camino del 504 tampoco lo es: significa «ya lo verifiqué
   * contra el servidor y tu mensaje SÍ entró», y es lo que impide que el
   * compositor le devuelva un texto que reenviar duplicaría.
   */
  const enviar = async (texto: string): Promise<boolean> => {
    const turnosAntes = foto.vista.turnos;

    // El mismo texto que sigue sin entrar conserva su id. Sólo se estrena uno
    // cuando el mensaje es de verdad otro.
    if (envio.current?.texto !== texto) envio.current = { texto, id: nuevoEnvio() };
    const turnoId = envio.current.id;

    setEnVuelo(nuevoTurno('user', texto, foto.vista.fase));
    try {
      await llamar('turno', { texto, turnoId });
      envio.current = null;
      return true;
    } catch (e) {
      if (e instanceof SeTardo) {
        // Un 504 no dice si el turno entró. Preguntar es barato; reenviar a
        // ciegas le cuesta a la persona su mensaje repetido y, si ese turno
        // cerraba la fase 5, un segundo Mapa de Negocio.
        const fresca = await releer();

        if (fresca && fresca.vista.turnos > turnosAntes) {
          envio.current = null;
          setError(null);
          setAviso(
            'Tu agente se tardó, pero tu mensaje sí entró: aquí está lo que contestó. ' +
              'No hace falta que lo mandes otra vez.',
          );
          if (fresca.vista.status === 'cerrando') void esperarElMapa();
          return true;
        }

        setError(
          'Tu agente no alcanzó a contestar y tu mensaje no entró. ' +
            'Te lo devolvimos al cuadro de texto: mándalo cuando quieras.',
        );
        return false;
      }

      if (e instanceof SeAdelantaron) {
        // O se está cerrando el Ritual, o otra pestaña avanzó. En los dos casos
        // lo que la pantalla tiene pintado ya es viejo.
        const fresca = await releer();
        if (fresca?.vista.status === 'cerrando') {
          // No es un fallo: es la fase 6 corriendo. Se dice como lo que es y se
          // espera, en vez de enseñarle un error por haber llegado a tiempo.
          setError(null);
          setAviso(e.message);
          void esperarElMapa();
        }
        return false;
      }

      return false;
    }
  };

  /**
   * "Guardar y seguir después" → AL PANEL.
   *
   * Antes se quedaba aquí, escribiendo "guardado" debajo del mismo compositor
   * que acababa de dejar. Eso no es una salida: es una pantalla que se queda
   * quieta, y el invitado que quería irse se iba del producto entero.
   *
   * Ahora sale a su panel, que es el momento en que ve lo que ganó: sus áreas,
   * las abiertas encendidas y las cerradas con su promesa y qué les falta. Ése
   * es el gancho para volver — y sólo funciona si lo ve.
   *
   * La pausa se marca ANTES de navegar y con `keepalive`, porque irse de la
   * página cancela las peticiones en vuelo: sin eso, el 30% de las pausas se
   * perderían en el camino. Y si aun así falla, se navega igual: su avance ya
   * está guardado desde el turno anterior —la pausa sólo deja escrito que se
   * fue por su voluntad— así que quedarse aquí para reportar un fallo que no le
   * quita nada sería el peor de los dos mundos.
   */
  const pausar = (): void => {
    voz.callar();
    void fetch('/ritual/api/pausa', { method: 'POST', keepalive: true })
      .catch(() => undefined)
      .finally(() => {
        window.location.assign(EL_PANEL);
      });
  };

  /** Manda a leer su página. Nunca lanza: un `null` es "sigamos por lo normal". */
  const leerSitio = async (url: string): Promise<LecturaDelSitio | null> => {
    try {
      const r = await fetch('/ritual/api/sitio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) return null;
      return (await r.json()) as LecturaDelSitio;
    } catch {
      return null;
    }
  };

  /**
   * Lo que sacó de su página, ya confirmado, entra como un turno SUYO.
   *
   * Es lo que hace que no exista un camino de escritura paralelo: el agente
   * recibe una frase del invitado, la marca con sus `[DATO:…]` y las fases se
   * cierran con las mismas condiciones de siempre. Un atajo que escribiera
   * directo en el estado podría cerrar fases con datos que su dueño nunca vio.
   */
  const confirmarSitio = (propuestas: PropuestaDelSitio[]): void => {
    setSitioResuelto(true);
    if (propuestas.length === 0) return;

    const dicho = [
      'Esto es de mi página y ya lo revisé:',
      ...propuestas.map((p) => `- ${p.etiqueta.toLowerCase()}: ${p.valor}`),
    ].join('\n');

    void enviar(dicho);
  };

  const turnos = enVuelo ? [...foto.transcript, enVuelo] : foto.transcript;

  const ultimoDelAgente = React.useMemo(() => {
    for (let i = turnos.length - 1; i >= 0; i--) {
      const t = turnos[i];
      if (t?.role === 'assistant') return t.content;
    }
    return null;
  }, [turnos]);

  /**
   * Lo que YA estaba escrito al abrir la página no se lee en voz alta.
   *
   * Quien vuelve al día siguiente abre `/ritual` y encima está su conversación
   * completa. Sin esto, la voz arrancaría leyéndole el último mensaje de ayer
   * —que él ya leyó, y que puede ser el mapa entero— antes de que haya tocado
   * nada. Se anota como leído sin sonar. La primera narración de verdad es la
   * de la respuesta que pida HOY.
   */
  const inicialYaVista = React.useRef(
    (() => {
      for (let i = inicial.transcript.length - 1; i >= 0; i--) {
        const t = inicial.transcript[i];
        if (t?.role === 'assistant') return t.content;
      }
      return null;
    })(),
  );

  /**
   * Narrar la última pregunta del agente, cuando aparece.
   *
   * `narrar()` ignora un texto que acaba de leer, así que un re-render no
   * produce una segunda lectura. Y no se narra mientras se está grabando: el
   * micrófono no se puede grabar a sí mismo.
   *
   * Las dependencias son `voz.narrar` y `voz.grabando`, no `voz` entero: el
   * hook devuelve un objeto nuevo en cada render y depender de él haría correr
   * este efecto en todos ellos.
   */
  const { narrar: narrarConLaVoz, grabando: estaGrabando } = voz;

  React.useEffect(() => {
    if (!ultimoDelAgente || ocupado || estaGrabando) return;
    if (ultimoDelAgente === inicialYaVista.current) return;
    narrarConLaVoz(ultimoDelAgente);
  }, [estaGrabando, narrarConLaVoz, ocupado, ultimoDelAgente]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-8 sm:px-8">
      <header className="sticky top-0 z-10 -mx-5 bg-[hsl(var(--background)/0.85)] px-5 py-4 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <Progreso vista={foto.vista} />
          </div>
          <InterruptorDeVoz voz={voz} />
        </div>
      </header>

      <main id="contenido" className="flex flex-1 flex-col gap-8">
        {foto.memoria ? <Regreso memoria={foto.memoria} ausencia={foto.ausencia} /> : null}

        {turnos.length === 0 && !completada ? (
          <Esqueleto />
        ) : (
          <Conversacion
            turnos={turnos}
            agente={foto.vista.agente}
            pensando={ocupado || cerrando}
          />
        )}

        {/*
          El atajo de la página va AQUÍ y no en el pie, y es una decisión de
          teléfono: el pie es pegajoso, y con los botones de categoría, el campo
          de texto y encima esto, se comía media pantalla de un iPhone. Aquí
          hace scroll con la conversación, que es de donde salió.
        */}
        {ofrecerSitio ? (
          <Sitio
            ocupado={ocupado || cerrando}
            onLeer={leerSitio}
            onConfirmar={confirmarSitio}
            onOmitir={() => setSitioResuelto(true)}
          />
        ) : null}

        {completada && foto.mapa ? (
          <MapaDeNegocio mapa={foto.mapa} agente={foto.vista.agente} />
        ) : null}

        {aviso ? (
          <div
            role="status"
            aria-live="polite"
            className="glass flex items-start gap-3 rounded-xl p-4"
          >
            <Icon name="sparkles" className="mt-0.5 h-4 w-4 text-[hsl(var(--glow))]" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{aviso}</p>
          </div>
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

      {/*
       * El compositor NO desaparece al terminar el Ritual.
       *
       * Antes sí, y con eso el producto se quedaba mudo justo en el momento que
       * impresiona: la persona acababa de recibir su Mapa de Negocio y ya no
       * tenía dónde preguntarle nada a su agente. Ahora los turnos siguen
       * yendo a la misma acción; el motor sabe que el Ritual cerró y contesta
       * como su agente de todos los días. Ver `guionDespuesDelRitual`.
       */}
      <footer className="sticky bottom-0 -mx-5 bg-[hsl(var(--background)/0.9)] px-5 pb-6 pt-3 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <Compositor
          bautizo={bautizo}
          // Mientras se arma el mapa no hay turno que mandar: cualquier cosa
          // que se escriba aquí se toparía con la fase 6 en curso.
          ocupado={ocupado || cerrando}
          pausada={foto.vista.status === 'pausada'}
          terminado={completada}
          ayuda={foto.vista.ayuda}
          voz={voz}
          onEnviar={enviar}
          onPausar={pausar}
        />
      </footer>
    </div>
  );
}

function nuevoTurno(role: Turno['role'], content: string, fase: Turno['fase']): Turno {
  return { role, content, at: new Date().toISOString(), fase };
}
