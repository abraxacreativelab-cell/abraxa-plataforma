'use client';

import * as React from 'react';

export interface TransicionDeRutaProps {
  /** El pathname actual. Cambiarlo relanza la transición. */
  ruta: string;
  children: React.ReactNode;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Cambiar de sección es un movimiento, no un parpadeo
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El shell —barra lateral, encabezado— NO se mueve. Sólo el lienzo. Es lo que
 *  hace que navegar se sienta como abrir otro cajón del mismo mueble en vez de
 *  cargar otra página, y es la diferencia entre una app y un sitio web.
 *
 *  ── Por qué `key` y no una clase con `useEffect` ───────────────────────────
 *
 *  Porque `key={ruta}` obliga a React a MONTAR un elemento nuevo en cada
 *  cambio de ruta, y una animación CSS arranca sola al montar. Con una clase
 *  puesta por efecto habría que quitarla y volverla a poner en el fotograma
 *  siguiente —el truco del `void nodo.offsetWidth`— y esa clase de código se
 *  rompe en cuanto alguien navega dos veces rápido.
 *
 *  El costo de remontar es real: el subárbol pierde su estado de cliente. No
 *  importa aquí, porque la ruta ya cambió y ese estado pertenecía a la pantalla
 *  anterior. Lo que sí importa es que **el `key` va en un envoltorio y no en el
 *  contenido**: así el remontaje lo paga un `<div>` y no el árbol de la
 *  pantalla, que Next ya reemplazó por su cuenta.
 *
 *  ── El movimiento se apaga solo ────────────────────────────────────────────
 *
 *  `prefers-reduced-motion` desactiva `.transicion-de-ruta` en
 *  `styles.css`, dejando el contenido visible y quieto. Este componente no
 *  consulta el media query: si lo hiciera, el servidor no podría saber la
 *  respuesta y el primer render saldría distinto del cliente. El CSS sí lo sabe
 *  desde el primer píxel pintado.
 */
export function TransicionDeRuta({ ruta, children }: TransicionDeRutaProps) {
  return (
    <div key={ruta} className="transicion-de-ruta">
      {children}
    </div>
  );
}
