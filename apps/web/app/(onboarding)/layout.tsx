import { AccentScope } from '@abraxa/ui';

/**
 * Layout del route group `(onboarding)`. Dueño: H7.
 *
 * **A pantalla completa, sin el shell del producto.** Nada de barra lateral ni
 * de navegación por áreas: el emprendedor todavía no tiene áreas —se las va a
 * dar este ritual— y enseñarle un menú vacío en su primer minuto es prometerle
 * un sistema y entregarle un esqueleto. H5 lo dejó dicho en el layout raíz: la
 * landing y el Ritual son pantallas completas.
 *
 * El acento es el neutro luminoso por defecto. Todavía no hay marca del
 * emprendedor que respetar ni área en la que esté parado; cada tarjeta del Mapa
 * de Negocio pone el suyo en su propio subárbol al final del ritual.
 */
export default function GroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccentScope className="grid-bg relative min-h-screen">
      {/* Una fuga de luz muy tenue arriba: da profundidad sin competir con el
          texto, que es lo único que importa en esta pantalla. */}
      <div className="light-leak pointer-events-none absolute inset-x-0 top-0 h-64" aria-hidden />
      {children}
    </AccentScope>
  );
}
