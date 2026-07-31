import type { Metadata } from 'next';
import InboxScreen from './inbox-screen';
import RegistrarHerramienta from './registrar-herramienta';

export const metadata: Metadata = { title: 'Bandeja · ABRAXA Plataforma' };

/**
 * `/bandeja` — la pantalla de H6.
 *
 * El shell, la navegación por áreas y el acento contextual los pone
 * `(app)/layout.tsx`, que es de H5. Aquí sólo cuelga la pantalla.
 *
 * Es un componente de servidor que renderiza uno de cliente: la bandeja es
 * interactiva de arriba abajo (envío optimista, interruptor de IA, cambio de
 * hilo) y no hay nada que ganar renderizándola en el servidor. Los datos los
 * pide el cliente a `/bandeja/api/*`, que sí corre en el servidor y es donde
 * vive la sesión.
 */
export default function Page() {
  return (
    <>
      <RegistrarHerramienta />
      <InboxScreen />
    </>
  );
}
