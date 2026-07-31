import {
  ArrowRight,
  Bot,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Compass,
  Contact,
  CreditCard,
  DoorOpen,
  FileText,
  Gem,
  Headset,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Library,
  LifeBuoy,
  ListChecks,
  LockKeyhole,
  Map,
  Megaphone,
  Menu,
  MessagesSquare,
  PanelLeft,
  Plus,
  RefreshCw,
  Route,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  Users,
  Wallet,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * El icono viene de la base de datos como una cadena, así que hace falta un
 * mapa: el sidebar no está en el código y `AreaSummary.icon` es un `string`.
 *
 * Cada handoff que registre una herramienta escoge un nombre de esta lista. Si
 * pide uno que no está, sale el genérico — nunca un hueco ni un error.
 */
const ICONOS = {
  'arrow-right': ArrowRight,
  bot: Bot,
  building: Building2,
  calendar: CalendarDays,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  compass: Compass,
  contact: Contact,
  'credit-card': CreditCard,
  'door-open': DoorOpen,
  file: FileText,
  gem: Gem,
  headset: Headset,
  help: CircleHelp,
  inbox: Inbox,
  kanban: KanbanSquare,
  library: Library,
  lifebuoy: LifeBuoy,
  lock: LockKeyhole,
  map: Map,
  megaphone: Megaphone,
  menu: Menu,
  messages: MessagesSquare,
  panel: PanelLeft,
  panelleft: PanelLeft,
  plus: Plus,
  refresh: RefreshCw,
  reports: ChartNoAxesCombined,
  resumen: LayoutDashboard,
  route: Route,
  settings: Settings2,
  shield: ShieldCheck,
  sparkles: Sparkles,
  store: Store,
  target: Target,
  tasks: ListChecks,
  users: Users,
  wallet: Wallet,
  warning: CircleAlert,
  workflow: Workflow,
  wrench: Wrench,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONOS;

/** Los nombres válidos, para que un handoff pueda validar el suyo en pruebas. */
export const ICON_NAMES = Object.keys(ICONOS) as IconName[];

export interface IconProps {
  name?: string | null;
  className?: string;
  /** Un icono decorativo se oculta de los lectores de pantalla; uno que
   *  comunica algo lleva etiqueta. Por defecto es decorativo, que es el caso
   *  común: casi siempre va junto a su texto. */
  label?: string;
}

/**
 * Resuelve un nombre de la base de datos a un icono. Normaliza igual que
 * GARDEN (`messages_square`, `MessagesSquare` y `messages-square` son el mismo)
 * para que el dato pueda venir en cualquier convención.
 */
export function Icon({ name, className = 'h-4 w-4', label }: IconProps) {
  const clave = String(name ?? '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();

  const directo = (ICONOS as Record<string, LucideIcon>)[clave];
  const porGuiones = (ICONOS as Record<string, LucideIcon>)[
    Object.keys(ICONOS).find((k) => k.replace(/-/g, '') === clave) ?? ''
  ];
  const Componente = directo ?? porGuiones ?? Wrench;

  return (
    <Componente
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}
