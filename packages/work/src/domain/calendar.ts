/**
 * La rejilla del calendario. Pura y sin dependencias de fechas.
 *
 * Todo se calcula sobre cadenas `YYYY-MM-DD` en hora LOCAL. Es la corrección al
 * defecto de `calendar-view.tsx` de GARDEN, que comparaba `due_date` (una fecha
 * sin hora) contra `new Date().toISOString().slice(0,10)` (una fecha en UTC):
 * en México eso hacía que a partir de las 18:00 "vence hoy" ya dijera mañana.
 */
import { isOpen, type Task } from './types';
import { localDate } from './view';

export const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;

export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
  /** Pasado y todavía abierto. Es el único rojo del calendario. */
  isOverdue: boolean;
  tasks: Task[];
}

export interface CalendarMonth {
  year: number;
  /** 1–12. */
  month: number;
  label: string;
  /** Seis semanas de siete días. Siempre seis, para que el alto de la rejilla
   *  no salte al cambiar de mes. */
  weeks: CalendarDay[][];
  /** Las que no tienen fecha. No se esconden: son justo las que se olvidan. */
  undated: Task[];
}

/** `YYYY-MM` del mes al que pertenece una fecha. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** El lunes de la semana de `d`. La semana empieza en lunes: es la convención
 *  de México y de casi todo el mundo salvo Estados Unidos. */
function lunesDe(d: Date): Date {
  const copia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (copia.getDay() + 6) % 7; // 0 = lunes
  copia.setDate(copia.getDate() - dow);
  return copia;
}

export function buildMonth(
  year: number,
  month: number,
  tasks: readonly Task[],
  now = new Date(),
): CalendarMonth {
  const hoy = localDate(now);

  const porFecha = new Map<string, Task[]>();
  const undated: Task[] = [];
  for (const t of tasks) {
    if (!t.due_date) {
      undated.push(t);
      continue;
    }
    const lista = porFecha.get(t.due_date);
    if (lista) lista.push(t);
    else porFecha.set(t.due_date, [t]);
  }

  const cursor = lunesDe(new Date(year, month - 1, 1));
  const weeks: CalendarDay[][] = [];

  for (let w = 0; w < 6; w++) {
    const semana: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const fecha = localDate(cursor);
      const delDia = porFecha.get(fecha) ?? [];
      semana.push({
        date: fecha,
        dayOfMonth: cursor.getDate(),
        inMonth: cursor.getFullYear() === year && cursor.getMonth() === month - 1,
        isToday: fecha === hoy,
        isOverdue: fecha < hoy && delDia.some((t) => isOpen(t.status)),
        tasks: delDia,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(semana);
  }

  return {
    year,
    month,
    label: `${MESES[month - 1] ?? ''} ${year}`,
    weeks,
    undated,
  };
}

/** Qué se vence en los próximos `dias` días, ordenado. Es la respuesta directa
 *  a la pregunta que el handoff le pone a esta vista. */
export function dueWithin(tasks: readonly Task[], dias: number, now = new Date()): Task[] {
  const desde = localDate(now);
  const fin = new Date(now);
  fin.setDate(fin.getDate() + dias);
  const hasta = localDate(fin);

  return tasks
    .filter((t) => t.due_date != null && t.due_date >= desde && t.due_date <= hasta && isOpen(t.status))
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
}

/** Vencidas: fecha pasada y todavía abiertas. */
export function overdue(tasks: readonly Task[], now = new Date()): Task[] {
  const hoy = localDate(now);
  return tasks
    .filter((t) => t.due_date != null && t.due_date < hoy && isOpen(t.status))
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
}
