/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El regreso — la mitad del valor del Ritual.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  «Al reanudar, el agente resume lo que ya sabe y sigue. No vuelve a
 *  preguntar. Que el emprendedor sienta que lo recordaron es la mitad del
 *  valor.» — handoff §6.
 *
 *  Todo lo de este archivo es determinista y no toca al modelo. Es una decisión,
 *  no una limitación: quien vuelve tres días después abre la pantalla y ve
 *  INMEDIATAMENTE lo que el agente sabe de él, sin esperar a que un proveedor
 *  conteste y sin que un mal día del modelo se lo trague. El mensaje cálido de
 *  bienvenida sí lo escribe el agente (guion.ts, bloque «ÉL ACABA DE VOLVER»);
 *  esto es el respaldo que nunca falla.
 */
import type { EstadoNegocio, Fase } from '../types';
import { FASES, FICHAS, indiceDeFase } from './fases';

/** Cuánto tiempo pasó, dicho como lo diría una persona. */
export function ausenciaEnPalabras(desde: string | null, ahora: Date): string | null {
  if (!desde) return null;
  const t = Date.parse(desde);
  if (Number.isNaN(t)) return null;

  const minutos = Math.floor((ahora.getTime() - t) / 60_000);
  if (minutos < 30) return null; // No fue una ausencia, fue una pausa para pensar.
  if (minutos < 120) return 'hace un rato';

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} horas`;

  const dias = Math.floor(horas / 24);
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  if (dias < 14) return 'hace una semana';
  if (dias < 60) return `hace ${Math.floor(dias / 7)} semanas`;
  return `hace ${Math.floor(dias / 30)} meses`;
}

/**
 * Las tres o cuatro cosas más concretas que el agente sabe de este negocio.
 *
 * No es un volcado del estado: es lo que hay que decirle para que crea que se
 * le recordó. Se eligen los datos más específicos —los que él dijo con sus
 * palabras— y no las etiquetas genéricas.
 */
export function loQueRecuerdo(e: EstadoNegocio, maximo = 4): string[] {
  const candidatos: Array<string | null> = [
    e.giro ? `Te dedicas a ${e.giro}.` : null,
    e.nicho ? `Le vendes a ${e.nicho}.` : null,
    e.ticket ? `Tu ticket promedio anda en ${e.ticket}.` : null,
    e.modeloIngreso && !e.ticket ? `Cobras ${e.modeloIngreso}.` : null,
    (e.canales?.length ?? 0) > 0 ? `Te escriben por ${(e.canales ?? []).join(' y ')}.` : null,
    (e.recorrido?.length ?? 0) > 0
      ? `Tu proceso empieza en "${e.recorrido?.[0]?.nombre}" y lleva ${e.recorrido?.length} pasos.`
      : null,
    (e.dolores?.length ?? 0) > 0 ? `Lo que más te pesa: ${e.dolores?.[0]?.texto}.` : null,
    e.equipo ? `Trabajas ${e.equipo}.` : null,
  ];

  return candidatos.filter((x): x is string => x !== null).slice(0, maximo);
}

/**
 * El mensaje que la UI puede pintar antes de que el agente conteste.
 *
 * Deliberadamente en primera persona del agente: quien vuelve no está leyendo
 * un informe de estado, está retomando una conversación.
 */
export function mensajeDeRegreso(
  e: EstadoNegocio,
  fase: Fase,
  ausencia: string | null,
): string {
  const nombre = e.agente?.trim();
  const recuerdos = loQueRecuerdo(e);
  const indice = indiceDeFase(fase);

  const saludo = ausencia
    ? `Nos quedamos a medias ${ausencia}. Aquí sigo.`
    : 'Aquí seguimos.';

  const memoria =
    recuerdos.length > 0
      ? `Esto es lo que ya sé de tu negocio:\n${recuerdos.map((r) => `· ${r}`).join('\n')}`
      : 'Todavía no habíamos entrado en materia.';

  const rumbo = `Vamos en la fase ${indice + 1} de ${FASES.length}: ${FICHAS[fase].titulo.toLowerCase()}. ${FICHAS[fase].promesa}`;

  const firma = nombre ? `— ${nombre}` : '';

  return [saludo, memoria, rumbo, firma].filter((s) => s.length > 0).join('\n\n');
}
