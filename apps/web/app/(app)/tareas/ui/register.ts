'use client';

import { registerTools } from '@abraxa/ui';

/**
 * H9 registra SU herramienta desde su propio archivo — nadie edita un registro
 * central. Es el mecanismo que H5 publica en `tool-registry.ts` justo para esto.
 *
 * ── Sobre la clave ─────────────────────────────────────────────────────────
 *
 * `AreaSummary.tools` viene de la base de datos y lo llena H11. La clave que se
 * declara aquí, `direccion:tareas`, sólo se resuelve si H11 la incluye en las
 * herramientas de su área. Mientras no lo haga, este registro es inerte: no
 * estorba, no rompe nada y no aparece en ningún lado.
 *
 * Está anotado en el PR para que H11 la agregue. Registrarla por adelantado es
 * lo que permite que, el día que H11 la liste, la navegación funcione sin que
 * nadie tenga que volver a tocar este carril.
 */
registerTools({
  key: 'direccion:tareas',
  label: 'Tareas',
  icon: 'tasks',
  href: '/tareas',
  position: 3,
});
