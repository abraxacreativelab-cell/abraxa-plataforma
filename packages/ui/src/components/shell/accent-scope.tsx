import * as React from 'react';
import { accentForArea } from '../../lib/accent';

// Se excluye `color` del div: aquí significa "el acento de este ámbito", no el
// atributo HTML heredado de los noventa.
export interface AccentScopeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'color'> {
  /** Slug del área. Decide el color cuando no hay marca. */
  area?: string | null;
  /** El color de marca del emprendedor. Le gana al área en todas partes. */
  brand?: string | null;
  /** Un color explícito, sin pasar por área ni marca. Para vistas previas. */
  color?: string | null;
  children?: React.ReactNode;
}

/**
 * Recolorea todo su subárbol.
 *
 * Sobrescribe `--primary`, `--accent`, `--ring` y `--glow` —que son un mismo
 * token— en este contenedor. Como las variables CSS cascadean, cada
 * `text-primary`, `bg-primary`, `ring-*` y cada resplandor de aquí para abajo
 * cambia solo. **Sin tocar un solo hex** (criterio 2 del handoff).
 *
 * Lo que NO cambia: success, warning, error e info. Son fijos y no se emiten
 * aquí, así que "activo" sigue verde dentro de un área roja (criterio 4).
 *
 * Se puede anidar: el shell pone el acento por defecto y cada área lo
 * sobrescribe en su subárbol.
 */
export function AccentScope({ area, brand, color, children, style, ...props }: AccentScopeProps) {
  const { vars } = color ? accentForArea(null, color) : accentForArea(area, brand);

  return (
    <div data-accent={area ?? 'default'} style={{ ...vars, ...style } as React.CSSProperties} {...props}>
      {children}
    </div>
  );
}
