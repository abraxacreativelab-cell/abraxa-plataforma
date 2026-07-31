import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/**
 * Layout raíz. **Es de H5** (design system, shell y navegación).
 *
 * Sólo tres cosas: las fuentes, el lienzo y el salto al contenido. El shell del
 * producto (barra lateral, encabezado, acento por área) vive en
 * `(app)/layout.tsx`, porque `(public)` y `(onboarding)` no lo llevan: la
 * landing y el Ritual de Fundación son pantallas completas, sin navegación.
 *
 * Las fuentes entran por `next/font/google`, que las auto-hospeda en el build:
 * cero peticiones a terceros, cero salto de tipografía al cargar y **cero
 * dependencias nuevas**.
 *
 * GARDEN usaba Geist por el paquete `geist`, que aquí no está instalado (regla
 * 4: nadie instala nada) y que tampoco existe en el catálogo de
 * `next/font/google` de Next 14.2. Inter es el sustituto más cercano para la
 * interfaz, y JetBrains Mono da el aire técnico que el sistema le pide a los
 * `.eyebrow`. Si se quiere Geist de verdad, es una línea en el `package.json`
 * de H1 — queda anotado en el PR.
 */
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans-src',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-src',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'ABRAXA Plataforma',
    template: '%s · ABRAXA',
  },
  description: 'El sistema operativo de tu negocio.',
  applicationName: 'ABRAXA',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ABRAXA',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // El hex exacto de `--background` (222 28% 3.8%). Es el único literal de
  // color del carril, y no se puede evitar: la metadata de Next se serializa a
  // una etiqueta <meta> antes de que exista una hoja de estilos que consultar.
  // `tokens.test.ts` verifica que siga cuadrando con el token.
  themeColor: '#07090c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`dark ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <a href="#contenido" className="saltar-al-contenido">
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
