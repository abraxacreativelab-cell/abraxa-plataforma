/**
 * @abraxa/ui — design system, shell y navegación por áreas.
 *
 * Carril de H5. Es el único paquete que corre en el navegador: `apps/api` lo
 * conoce sólo por `@abraxa/ui/meta`, que no arrastra React.
 *
 * ── Las dos reglas de GARDEN que aquí siguen vigentes ────────────────────────
 *
 *  · **Cero hex en los componentes.** Todo por token. El acento entra por
 *    `--primary` / `--glow` y cada componente lo hereda solo. `accent.test.ts`
 *    revisa el código fuente y falla si alguien mete un hex o un color crudo de
 *    la paleta de Tailwind.
 *  · **Los estados semánticos NO siguen al acento.** success, warning, error e
 *    info son fijos: "activo" no puede volverse rojo dentro de un área roja.
 *
 * ── Cómo lo usa un handoff ───────────────────────────────────────────────────
 *
 *  El shell ya está puesto por `(app)/layout.tsx`. Cada handoff sólo escribe su
 *  pantalla dentro de su carpeta y, si su herramienta va en el sidebar, la
 *  registra desde SU propio paquete — nadie edita un registro central:
 *
 *      import { registerTools } from '@abraxa/ui';
 *
 *      registerTools({
 *        key: 'ventas:bandeja',        // la clave que devuelve AreasPort
 *        label: 'Bandeja',
 *        icon: 'inbox',
 *        href: '/bandeja',             // tu carpeta; la ruta la decides tú
 *        load: () => import('./inbox-screen'),
 *      });
 *
 *  Para que una pantalla nunca mienta sobre lo que está pasando:
 *
 *      <AsyncBoundary state={estado} empty={<EmptyState title="Aún no tienes contactos" />}>
 *        {(contactos) => <Tabla filas={contactos} />}
 *      </AsyncBoundary>
 *
 *  Los tokens viven en `src/styles.css`, que importa `apps/web/app/globals.css`.
 */

export { meta } from './meta';

// ── Utilidades ──────────────────────────────────────────────────────────────
export { cn } from './lib/cn';

export {
  AA_LARGE,
  AA_NORMAL,
  HARDEST_SURFACE,
  HEX_ERROR,
  MIN_ACCENT_LUMINANCE,
  SURFACES,
  contrastBetween,
  contrastRatio,
  ensureReadable,
  hslToRgb,
  luminance,
  minLuminanceOver,
  parseHex,
  readableOn,
  rgbToHsl,
  toHex,
  toTriplet,
  type HexParse,
  type Hsl,
} from './lib/color';

export {
  AREA_ACCENTS,
  DEFAULT_ACCENT,
  accentForArea,
  accentVars,
  resolveAccent,
  type AccentResult,
  type AccentVars,
} from './lib/accent';

// ── Primitivos ──────────────────────────────────────────────────────────────
export { Button, buttonVariants, type ButtonProps } from './components/primitives/button';
export { Badge, badgeVariants, type BadgeProps } from './components/primitives/badge';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/primitives/card';
export {
  Input,
  Textarea,
  type InputProps,
  type TextareaProps,
} from './components/primitives/input';
export { Select, type SelectProps } from './components/primitives/select';
export { Separator, type SeparatorProps } from './components/primitives/separator';
export { Skeleton, SkeletonText } from './components/primitives/skeleton';
export { ICON_NAMES, Icon, type IconName, type IconProps } from './components/primitives/icon';

// ── Estados honestos ────────────────────────────────────────────────────────
export { EmptyState, type EmptyStateProps } from './components/feedback/empty-state';
export { LoadError, type LoadErrorProps } from './components/feedback/load-error';
// Desde `failure.ts` y NO reexportado a través de `load-error.tsx`: si pasara
// por un módulo `'use client'`, Next trataría `toLoadFailure` como referencia
// de cliente y llamarla desde un componente de servidor fallaría.
export {
  FAILURE_COPY,
  toLoadFailure,
  type LoadFailure,
  type LoadFailureKind,
} from './components/feedback/failure';
export {
  AsyncBoundary,
  DefaultEmpty,
  type AsyncBoundaryProps,
  type AsyncState,
} from './components/feedback/async-boundary';
export { LockedArea, type LockedAreaProps } from './components/feedback/locked-area';

// ── Shell y navegación ──────────────────────────────────────────────────────
export { AppShell, findActiveArea, type AppShellProps } from './components/shell/app-shell';
export { AccentScope, type AccentScopeProps } from './components/shell/accent-scope';
export { Sidebar, type SidebarProps } from './components/shell/sidebar';
export { SidebarArea, type SidebarAreaProps } from './components/shell/sidebar-area';
export { Topbar, type TopbarProps } from './components/shell/topbar';
export { MobileNav, type MobileNavProps } from './components/shell/mobile-nav';

// ── Registro de herramientas ────────────────────────────────────────────────
export {
  assertToolsRegistered,
  lookupTool,
  missingKeys,
  registerFallbackTools,
  registerTools,
  registeredKeys,
  toolsForArea,
  type ToolRegistration,
} from './components/registry/tool-registry';
export { ToolOutlet } from './components/registry/tool-outlet';

// ── Datos de navegación ─────────────────────────────────────────────────────
export { MOCK_AREAS, MOCK_REQUIREMENTS, registerMockTools } from './components/nav/mock-areas';
export { isNavigable, resolveAreas, type AreasResult } from './components/nav/resolve-areas';
