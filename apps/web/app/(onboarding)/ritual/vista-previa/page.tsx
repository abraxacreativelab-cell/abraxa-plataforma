import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Escenas } from './escenas';

export const metadata: Metadata = { title: 'Ritual · vista previa' };

/**
 * Storyboard del Ritual, **sólo en desarrollo**.
 *
 * El Ritual de verdad necesita una sesión verificada (H2) y una llave de modelo,
 * y ninguna de las dos existe todavía. Esta ruta permite ver y criticar la
 * pantalla hoy sin fingir que hay un producto detrás: los datos son de ejemplo
 * y se anuncia como tal en la propia página.
 *
 * En producción devuelve 404 antes de renderizar nada. Es el mismo criterio con
 * el que H5 dejó su interruptor de estados del shell: útil para verificar, y
 * apagado donde hay clientes.
 */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Escenas />;
}
