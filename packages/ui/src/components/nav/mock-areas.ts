import type { AreaSummary } from '@abraxa/db/ports';
import { registerFallbackTools } from '../registry/tool-registry';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las cuatro áreas de v1 — andamio mientras H11 no exista
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El handoff §7 dice: *"H11 llena esos datos. Tú consumes el endpoint y
 *  renderizas. Mientras H11 no exista, usa un mock con las cuatro áreas de v1."*
 *
 *  Cuáles son las cuatro está en la decisión D5 del plan maestro: Ventas/MKT,
 *  Dirección, Onboarding y Servicio. (El §6 del handoff lista seis, pero RH y
 *  Finanzas son de después; su color ya está en `AREA_ACCENTS` para que H11
 *  pueda encenderlas sin tocar este paquete.)
 *
 *  Las promesas son las del plan §5.3, textuales. No son relleno: es lo que ve
 *  el emprendedor junto al candado, y la curiosidad es el motor del producto.
 *
 *  Los cuatro estados están representados a propósito, para que el shell se
 *  pueda verificar entero sin esperar a H11.
 */
export const MOCK_AREAS: AreaSummary[] = [
  {
    slug: 'ventas',
    label: 'Ventas y Marketing',
    icon: 'megaphone',
    position: 0,
    state: 'activa',
    access: 'admin',
    blurb: 'Qué cambia cuando tienes un equipo de ventas que nunca duerme.',
    tools: ['ventas:resumen', 'ventas:bandeja', 'ventas:contactos', 'ventas:pipeline'],
  },
  {
    slug: 'direccion',
    label: 'Dirección',
    icon: 'compass',
    position: 1,
    state: 'en_progreso',
    access: 'admin',
    blurb: 'Por qué tus números en un solo lugar hacen que todo lo demás deje de mentir.',
    tools: ['direccion:resumen', 'direccion:valores', 'direccion:biblioteca'],
  },
  {
    slug: 'servicio',
    label: 'Servicio al cliente',
    icon: 'headset',
    position: 2,
    state: 'disponible',
    access: 'edit',
    blurb: 'Dejar de perder clientes por no contestar.',
    tools: ['servicio:resumen', 'servicio:conversaciones'],
  },
  {
    slug: 'onboarding',
    label: 'Onboarding',
    icon: 'door-open',
    position: 3,
    // Bloqueada a propósito: es el criterio 5 del handoff — candado, promesa,
    // y no clickeable.
    state: 'bloqueada',
    access: null,
    blurb: 'Cómo se siente un cliente que entra a tu negocio.',
    tools: [],
  },
];

/**
 * Qué hace falta para abrir cada área (plan maestro §5.3). H11 lo servirá desde
 * `tenant_areas.requirements`; mientras tanto vive aquí para que el candado
 * diga algo útil en vez de sólo "bloqueada".
 */
export const MOCK_REQUIREMENTS: Record<string, string> = {
  ventas: 'conectas un canal y defines tu embudo',
  direccion: 'cargas un documento o defines tres valores de tu negocio',
  servicio: 'tienes cinco contactos activos',
  onboarding: 'cierras tu primera venta en el sistema',
};

/**
 * Etiquetas, iconos y rutas de las herramientas del mock.
 *
 * Se registran como RESPALDO: si el handoff dueño ya registró su herramienta de
 * verdad, la suya manda. Así el shell es navegable hoy y no le estorba a nadie
 * cuando aterrice. Las rutas ya apuntan a las carpetas correctas de cada
 * handoff — H6 sólo tendrá que añadir su `load`.
 */
export function registerMockTools(): void {
  registerFallbackTools(
    { key: 'ventas:resumen', label: 'Resumen', icon: 'resumen', href: '/ventas', position: 0 },
    { key: 'ventas:bandeja', label: 'Bandeja', icon: 'inbox', href: '/bandeja', position: 1 },
    { key: 'ventas:contactos', label: 'Contactos', icon: 'contact', href: '/ventas/contactos', position: 2 },
    { key: 'ventas:pipeline', label: 'Embudo', icon: 'kanban', href: '/ventas/pipeline', position: 3 },

    { key: 'direccion:resumen', label: 'Panel', icon: 'resumen', href: '/direccion', position: 0 },
    { key: 'direccion:valores', label: 'Valores', icon: 'gem', href: '/direccion/valores', position: 1 },
    { key: 'direccion:biblioteca', label: 'Biblioteca', icon: 'library', href: '/direccion/biblioteca', position: 2 },

    { key: 'servicio:resumen', label: 'Resumen', icon: 'resumen', href: '/servicio', position: 0 },
    { key: 'servicio:conversaciones', label: 'Conversaciones', icon: 'messages', href: '/bandeja', position: 1 },
  );
}
