import type { AreaAccess } from '@abraxa/db/ports';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El registro de herramientas — descentralizado a propósito
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `AreaSummary.tools` viene de la base de datos como una lista de claves
 *  `"area:herramienta"`. Este registro dice qué es cada clave: cómo se llama,
 *  qué icono lleva, a qué ruta apunta y qué componente la pinta.
 *
 *  ── Por qué NO es como el de GARDEN ────────────────────────────────────────
 *
 *  GARDEN tenía un objeto `LIST` con 26 claves y 26 imports en un solo archivo.
 *  Portarlo tal cual convertiría este archivo —que es de H5— en el cuello de
 *  botella por el que tendrían que pasar los otros 13 handoffs. El handoff lo
 *  dice explícito: *"cada handoff registra sus herramientas en su propio
 *  archivo dentro de su carpeta, así nadie edita un registro central"*.
 *
 *  Aquí H5 publica sólo la MECÁNICA. Cada handoff llama a `registerTools()`
 *  desde su paquete:
 *
 *      // packages/inbox/src/ui/register.ts   ← archivo de H6, carril de H6
 *      registerTools({
 *        key: 'ventas:bandeja',
 *        label: 'Bandeja',
 *        icon: 'inbox',
 *        href: '/bandeja',
 *        load: () => import('./inbox-screen'),
 *      });
 *
 *  ── Y por qué la RUTA vive aquí y no en la base de datos ───────────────────
 *
 *  Las áreas del negocio (ventas, dirección, onboarding, servicio) no coinciden
 *  con las carpetas de `apps/web` (bandeja, tareas, automatizaciones, mapa),
 *  porque las carpetas están repartidas por handoff. Si la ruta se dedujera de
 *  `área/herramienta` como en GARDEN, el sidebar apuntaría a carpetas que no
 *  existen.
 *
 *  Con `href` explícito, `Ventas → Bandeja` apunta a `/bandeja` (carpeta de H6)
 *  y `Dirección → Valores` a `/direccion/valores` (carpeta de H4) sin que nadie
 *  mueva un archivo. La navegación deja de estar atada a la estructura de
 *  carpetas, que es justo lo que permite que 14 handoffs no se pisen.
 */

import type { ComponentType } from 'react';

export interface ToolRegistration {
  /** `"area:herramienta"`. Es la misma clave que devuelve `AreasPort`. */
  key: string;
  label: string;
  /** Nombre de icono. Ver `ICON_NAMES` en `primitives/icon.tsx`. */
  icon: string;
  /** Ruta absoluta. La decide el handoff dueño, que es quien sabe dónde vive. */
  href: string;
  /** Carga diferida del componente. Opcional: hay herramientas que sólo son un
   *  enlace a una pantalla que ya existe. */
  load?: () => Promise<{ default: ComponentType }>;
  /** Acceso mínimo. Si el usuario no lo tiene, la herramienta no se lista. */
  minAccess?: AreaAccess;
  /** Orden dentro del área. Sin esto, el orden es el de registro. */
  position?: number;
}

const registro = new Map<string, ToolRegistration>();

/** Registra una o varias herramientas. Idempotente: volver a registrar la misma
 *  clave la reemplaza, que es lo que hace falta con el recarga-en-caliente. */
export function registerTools(...tools: ToolRegistration[]): void {
  for (const tool of tools) {
    if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(tool.key)) {
      throw new Error(
        `Clave de herramienta inválida: "${tool.key}". El formato es "area:herramienta", ` +
          'en minúsculas y con guiones (por ejemplo "ventas:mi-dia").',
      );
    }
    registro.set(tool.key, tool);
  }
}

/**
 * Registra sólo lo que nadie ha registrado todavía.
 *
 * Es lo que usa el mock de áreas para que el sidebar sea navegable antes de que
 * existan H6, H9 y compañía — sin el riesgo de pisar al handoff de verdad si
 * éste ya aterrizó. El orden de importación deja de importar.
 */
export function registerFallbackTools(...tools: ToolRegistration[]): void {
  registerTools(...tools.filter((t) => !registro.has(t.key)));
}

export function lookupTool(key: string): ToolRegistration | null {
  return registro.get(key) ?? null;
}

export function registeredKeys(): string[] {
  return [...registro.keys()].sort();
}

/** Las herramientas de un área, ya resueltas, ordenadas y filtradas por acceso. */
export function toolsForArea(
  keys: readonly string[],
  access: AreaAccess | null,
): ToolRegistration[] {
  const orden: Record<AreaAccess, number> = { view: 0, edit: 1, admin: 2 };
  const nivel = access ? orden[access] : -1;

  return keys
    .map(lookupTool)
    .filter((t): t is ToolRegistration => t !== null)
    .filter((t) => !t.minAccess || nivel >= orden[t.minAccess])
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** Las claves que la base de datos pide y nadie ha registrado. */
export function missingKeys(keys: readonly string[]): string[] {
  return keys.filter((k) => !registro.has(k));
}

/**
 * El guard de desarrollo que pide el handoff. GARDEN lo tenía y hay que
 * conservarlo — pero **movido**: allá lanzaba en el ámbito del módulo, así que
 * la primera clave huérfana reventaba el render antes de que se viera nada.
 *
 * Aquí junta TODAS las que faltan y las reporta de una vez, con el área a la
 * que pertenecen, para que la conversación dueña se corrija sola sin
 * preguntarle a nadie. En producción no lanza: una herramienta sin componente
 * se degrada, no tira la aplicación encima del cliente.
 */
export function assertToolsRegistered(keys: readonly string[]): void {
  if (process.env.NODE_ENV === 'production') return;

  const faltan = missingKeys(keys);
  if (faltan.length === 0) return;

  const porArea = faltan.reduce<Record<string, string[]>>((acc, k) => {
    const area = k.split(':')[0] ?? k;
    (acc[area] ??= []).push(k);
    return acc;
  }, {});

  const detalle = Object.entries(porArea)
    .map(([area, claves]) => `  · área "${area}": ${claves.join(', ')}`)
    .join('\n');

  throw new Error(
    `Hay herramientas sin componente registrado:\n${detalle}\n\n` +
      'Cada handoff registra las suyas con registerTools() desde su propio paquete ' +
      '(por ejemplo packages/inbox/src/ui/register.ts). Nadie edita un registro central.\n' +
      `Registradas ahora mismo: ${registeredKeys().join(', ') || '(ninguna)'}`,
  );
}

/** Sólo para pruebas: deja el registro en blanco. */
export function __resetRegistry(): void {
  registro.clear();
}
