/**
 * Horario de atención, por canal.
 *
 * Sin dependencias: `Intl.DateTimeFormat` con `timeZone` ya sabe de horarios de
 * verano y de las zonas raras. Meter una librería de fechas para esto sería
 * pagar 70 kB por lo que el runtime ya trae — y H1 dejó dicho que nadie instala
 * dependencias.
 *
 * El default es 24/7 y no es pereza: la frase que vende el producto es "tu
 * agente contesta a tus clientes mientras duermes". Un horario vacío tiene que
 * significar que sí contesta, no que no.
 */
import { log } from '../logger';
import type { BusinessHours, DiaSemana } from '../types';

const DIAS: DiaSemana[] = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

/**
 * ¿Conoce el runtime esta zona horaria?
 *
 * Se pregunta ANTES de guardar (`validarHorario`) para poder rechazar la
 * captura, y también en el camino caliente para poder avisar. `Intl` no expone
 * un "¿es válida?": la única forma es construir el formateador y ver si lanza.
 */
export function zonaValida(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Zonas ya avisadas, para no repetir el aviso en cada mensaje.
 *
 * Sin esto, un solo cliente con la zona mal escrita llena el log con una línea
 * por cada WhatsApp que entra — y un log que grita en cada mensaje se aprende a
 * ignorar, que es la misma sordera que teníamos con el `catch` vacío. El
 * conjunto se queda en memoria del proceso: como mucho crece con el número de
 * zonas distintas mal escritas, que es un puñado.
 */
const yaAvisadas = new Set<string>();

/** Sólo para las pruebas: vuelve a permitir el aviso de una zona. */
export function __olvidarAvisosDeZona(): void {
  yaAvisadas.clear();
}

/** Minutos desde medianoche de un `"HH:MM"`. `null` si no es una hora válida. */
export function minutosDe(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Día y minuto local en la zona pedida.
 *
 * Se usa `formatToParts` en vez de aritmética con `getTimezoneOffset()` porque
 * el offset del servidor no es el del negocio, y porque un cambio de horario de
 * verano movería la frontera del horario sin que nadie lo tocara.
 */
export function momentoLocal(ahora: Date, tz: string | undefined): { dia: DiaSemana; minutos: number } {
  if (!tz) {
    return { dia: DIAS[ahora.getUTCDay()] as DiaSemana, minutos: ahora.getUTCHours() * 60 + ahora.getUTCMinutes() };
  }

  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(ahora);

    const buscar = (t: string): string => partes.find((p) => p.type === t)?.value ?? '';
    const semana: Record<string, DiaSemana> = {
      Sun: 'dom',
      Mon: 'lun',
      Tue: 'mar',
      Wed: 'mie',
      Thu: 'jue',
      Fri: 'vie',
      Sat: 'sab',
    };
    const dia = semana[buscar('weekday')] ?? (DIAS[ahora.getUTCDay()] as DiaSemana);
    // A las 24:00 `hour12: false` puede devolver "24" en algunos ICU.
    const hora = Number(buscar('hour')) % 24;
    const minuto = Number(buscar('minute'));
    return { dia, minutos: hora * 60 + minuto };
  } catch (err) {
    // ── Se cae a UTC, pero ya NO en silencio (2026-07-31) ──────────────────
    //
    // Seguir en vez de romper es correcto: un horario mal capturado no puede
    // tirar la ingesta de un mensaje. Callarse no lo era. La consecuencia de
    // esta rama no es cosmética: un negocio en `America/Mexico_City` con la
    // zona mal escrita —`America/MexicoCity`, `GMT-6`, la que pegó el cliente
    // desde una hoja de cálculo— queda evaluado en UTC, seis horas corrido.
    // Su agente contesta de madrugada y se calla a media tarde, con la
    // configuración en pantalla diciendo exactamente lo contrario. Sin una
    // línea de log, eso se diagnostica leyendo este archivo.
    //
    // Se avisa UNA vez por zona: ver `yaAvisadas`.
    if (!yaAvisadas.has(tz)) {
      yaAvisadas.add(tz);
      log.warn(
        `zona horaria desconocida "${tz}" en el horario de atención: el horario se está ` +
          'evaluando en UTC y puede abrir y cerrar a horas equivocadas. ' +
          `Usa un identificador de la IANA, p. ej. "America/Mexico_City". (${String(err)})`,
      );
    }
    return { dia: DIAS[ahora.getUTCDay()] as DiaSemana, minutos: ahora.getUTCHours() * 60 + ahora.getUTCMinutes() };
  }
}

/**
 * ¿Estamos dentro del horario de atención?
 *
 * Reglas, todas con su razón:
 *   · Sin horario configurado (o sin ningún día con tramos) → SIEMPRE dentro.
 *   · Un día sin tramos es un día cerrado.
 *   · El tramo es `[inicio, fin)`: a las 18:00 en punto con cierre a las 18:00
 *     ya está cerrado. Si fuera cerrado, dos tramos contiguos (09:00–14:00 y
 *     14:00–19:00) se traslaparían un minuto.
 *   · `["20:00","02:00"]` cruza la medianoche y cuenta como abierto hasta las
 *     02:00 del día siguiente. Un bar que cierra a las 2am es un caso normal,
 *     no un error de captura.
 */
export function dentroDeHorario(horario: BusinessHours | null | undefined, ahora: Date): boolean {
  const semana = horario?.semana;
  if (!semana) return true;

  const dias = Object.entries(semana).filter(([, tramos]) => Array.isArray(tramos) && tramos.length > 0);
  if (dias.length === 0) return true;

  const { dia, minutos } = momentoLocal(ahora, horario?.tz);

  if (enAlgunTramo(semana[dia], minutos, false)) return true;

  // Un tramo del día ANTERIOR que cruzó la medianoche.
  const anterior = DIAS[(DIAS.indexOf(dia) + 6) % 7] as DiaSemana;
  return enAlgunTramo(semana[anterior], minutos, true);
}

function enAlgunTramo(
  tramos: Array<[string, string]> | undefined,
  minutos: number,
  soloCruzados: boolean,
): boolean {
  if (!Array.isArray(tramos)) return false;

  for (const tramo of tramos) {
    const inicio = minutosDe(tramo?.[0] ?? '');
    const fin = minutosDe(tramo?.[1] ?? '');
    if (inicio === null || fin === null) continue;

    const cruza = fin <= inicio;
    if (soloCruzados) {
      // Sólo interesa la cola del tramo de ayer, la parte después de la
      // medianoche de hoy.
      if (cruza && minutos < fin) return true;
      continue;
    }
    if (cruza) {
      if (minutos >= inicio) return true;
    } else if (minutos >= inicio && minutos < fin) {
      return true;
    }
  }
  return false;
}
