import type { BusinessMap } from '@abraxa/areas';

/**
 * Un mapa de mentiras, SÓLO para desarrollo.
 *
 * Sirve para dos cosas: verificar los criterios visuales del handoff —el
 * candado con su promesa, la barra de avance, lo que ya construyó viéndose
 * construido— sin esperar a que aterrice la sesión, y que cualquiera de los
 * otros carriles pueda ver cómo se comporta el mapa sin levantar una base.
 *
 * Es el mismo interruptor que H5 dejó en `(app)/layout.tsx` con
 * `abraxa_shell_demo` y H9 en `/tareas` con `abraxa_work_demo`, y por la misma
 * razón. `page.tsx` NI SIQUIERA lee la cookie en producción.
 *
 * Los cuatro estados están representados a propósito, y los textos son los del
 * catálogo de verdad (migración 090): una demo que miente sobre el copy no
 * sirve para revisar el copy.
 */
export function mapaDemo(): BusinessMap {
  const ahora = new Date();
  const hace = (dias: number): string =>
    new Date(ahora.getTime() - dias * 86_400_000).toISOString();

  return {
    empty: false,
    signals: {
      channels_active: 1,
      pipeline_stages: 4,
      values_active: 3,
      documents: 2,
      contacts_active: 3,
      deals_won: 0,
      months_operating: 2,
    },
    areas: [
      {
        slug: 'ventas',
        label: 'Ventas',
        icon: 'target',
        position: 1,
        state: 'activa',
        access: 'admin',
        blurb: 'Un equipo de ventas que nunca duerme: contesta, da seguimiento y no deja caer a nadie.',
        tools: ['ventas:resumen', 'ventas:bandeja', 'ventas:contactos', 'ventas:pipeline'],
        missing: [],
        ratio: 1,
        unlockedAt: hace(41),
        navigable: true,
      },
      {
        slug: 'operaciones',
        label: 'Operaciones',
        icon: 'wrench',
        position: 2,
        state: 'en_progreso',
        access: 'admin',
        blurb: 'Que lo que vendes se entregue igual de bien cuando no estás tú.',
        tools: [],
        missing: [],
        ratio: 1,
        unlockedAt: hace(6),
        navigable: true,
      },
      {
        slug: 'direccion',
        label: 'Dirección',
        icon: 'compass',
        position: 3,
        state: 'disponible',
        access: 'admin',
        blurb: 'Tus números en un solo lugar, para que nada más mienta.',
        tools: ['direccion:resumen', 'direccion:valores', 'direccion:biblioteca', 'direccion:tareas'],
        missing: [],
        ratio: 1,
        unlockedAt: hace(2),
        navigable: true,
      },
      {
        slug: 'servicio',
        label: 'Atención a clientes',
        icon: 'headset',
        position: 4,
        state: 'bloqueada',
        access: null,
        blurb: 'Dejar de perder clientes por no contestar.',
        tools: ['servicio:resumen', 'servicio:conversaciones'],
        missing: ['tienes 5 contactos activos'],
        ratio: 0.6,
        unlockedAt: null,
        navigable: false,
      },
      {
        slug: 'onboarding',
        label: 'Onboarding',
        icon: 'door-open',
        position: 5,
        state: 'bloqueada',
        access: null,
        blurb: 'Cómo se siente entrar a tu negocio siendo cliente.',
        tools: [],
        missing: ['cierras tu primera venta en el sistema'],
        ratio: 0,
        unlockedAt: null,
        navigable: false,
      },
      {
        slug: 'finanzas',
        label: 'Finanzas',
        icon: 'wallet',
        position: 6,
        state: 'bloqueada',
        access: null,
        blurb: 'Saber si de verdad ganas.',
        tools: [],
        missing: ['cumples 3 meses de operación'],
        ratio: 0.667,
        unlockedAt: null,
        navigable: false,
      },
      {
        slug: 'rh',
        label: 'Recursos humanos',
        icon: 'users',
        position: 7,
        state: 'bloqueada',
        access: null,
        blurb: 'Graduarte de solopreneur.',
        tools: [],
        missing: ['nos dices que vas a contratar'],
        ratio: 0,
        unlockedAt: null,
        navigable: false,
      },
    ],
    milestones: [
      {
        id: 'm1',
        areaSlug: 'ventas',
        title: 'Contestar todo prospecto en menos de una hora',
        description: 'Aunque sea para decir "ahorita te mando el detalle".',
        position: 1,
        done: true,
        doneAt: hace(20),
        generatedBy: 'master_agent',
      },
      {
        id: 'm2',
        areaSlug: 'direccion',
        title: 'Tener la lista de precios en un solo lugar',
        description: null,
        position: 2,
        done: true,
        doneAt: hace(4),
        generatedBy: 'master_agent',
      },
      {
        id: 'm3',
        areaSlug: null,
        title: 'Cerrar tu primera venta dentro del sistema',
        description: 'Es lo que abre Onboarding.',
        position: 3,
        done: false,
        doneAt: null,
        generatedBy: 'master_agent',
      },
      {
        id: 'm4',
        areaSlug: 'finanzas',
        title: 'Saber cuánto te queda al mes',
        description: null,
        position: 4,
        done: false,
        doneAt: null,
        generatedBy: 'master_agent',
      },
      {
        id: 'm5',
        areaSlug: null,
        title: 'Soltar la primera cosa que hoy sólo haces tú',
        description: null,
        position: 5,
        done: false,
        doneAt: null,
        generatedBy: 'user',
      },
    ],
  };
}
