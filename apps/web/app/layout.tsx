import type { Metadata, Viewport } from 'next';
import './globals.css';

/**
 * Layout raíz. **Es de H5** (design system, shell y navegación).
 * H1 sólo lo dejó válido para que las 8 rutas rendericen desde el día uno.
 */
export const metadata: Metadata = {
  title: 'ABRAXA Plataforma',
  description: 'El sistema operativo de tu negocio.',
};

export const viewport: Viewport = {
  themeColor: '#0a0c11',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
