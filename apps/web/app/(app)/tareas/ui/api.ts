'use client';

import type { Project, SavedView, Task, TaskComment } from '@abraxa/work/domain';
import type { DetalleTarea, Fallo, Resultado } from '../action-types';
import * as acciones from '../actions';

/**
 * Lo que la pantalla necesita poder hacer.
 *
 * Es una interfaz y no una llamada directa a las acciones de servidor por una
 * razón concreta: con `modo="demo"` la MISMA pantalla corre contra una
 * implementación en memoria. No es una maqueta aparte que se va separando de
 * la de verdad — es la de verdad, con otro respaldo. Si un botón se rompe en
 * demostración, está roto.
 */
export interface WorkApi {
  crearTarea(input: Record<string, unknown>): Promise<Task | Fallo>;
  actualizarTarea(id: string, patch: Record<string, unknown>): Promise<Task | Fallo>;
  borrarTarea(id: string): Promise<null | Fallo>;
  completarTodas(id: string): Promise<{ closed: number } | Fallo>;
  reordenar(moves: unknown[]): Promise<{ moved: number } | Fallo>;
  comentar(id: string, body: string): Promise<TaskComment | Fallo>;
  cargarDetalle(id: string): Promise<DetalleTarea | Fallo>;

  crearProyecto(name: string): Promise<Project | Fallo>;
  actualizarProyecto(id: string, patch: Record<string, unknown>): Promise<Project | Fallo>;
  borrarProyecto(id: string): Promise<{ orphaned: number } | Fallo>;

  guardarVista(input: Record<string, unknown>): Promise<SavedView | Fallo>;
  actualizarVista(id: string, patch: Record<string, unknown>): Promise<SavedView | Fallo>;
  borrarVista(id: string): Promise<null | Fallo>;
}

/** Desenvuelve el `Resultado<T>` de una acción de servidor. */
const abrir = async <T>(p: Promise<Resultado<T>>): Promise<T | Fallo> => {
  const r = await p;
  return r.ok ? r.data : r;
};

export const apiReal: WorkApi = {
  crearTarea: (input) => abrir(acciones.crearTarea(input)),
  actualizarTarea: (id, patch) => abrir(acciones.actualizarTarea(id, patch)),
  borrarTarea: (id) => abrir(acciones.borrarTarea(id)),
  completarTodas: (id) => abrir(acciones.completarTodas(id)),
  reordenar: (moves) => abrir(acciones.reordenar(moves)),
  comentar: (id, body) => abrir(acciones.comentar(id, body)),
  cargarDetalle: (id) => abrir(acciones.cargarDetalle(id)),

  crearProyecto: (name) => abrir(acciones.crearProyecto({ name })),
  actualizarProyecto: (id, patch) => abrir(acciones.actualizarProyecto(id, patch)),
  borrarProyecto: (id) => abrir(acciones.borrarProyecto(id)),

  guardarVista: (input) => abrir(acciones.guardarVista(input)),
  actualizarVista: (id, patch) => abrir(acciones.actualizarVista(id, patch)),
  borrarVista: (id) => abrir(acciones.borrarVista(id)),
};

/** `true` si lo que devolvió la API es un fallo. */
export function esFallo(r: unknown): r is Fallo {
  return typeof r === 'object' && r !== null && 'ok' in r && (r as { ok: unknown }).ok === false;
}
