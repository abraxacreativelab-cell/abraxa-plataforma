import type { Config } from 'tailwindcss';

/**
 * Andamio de H1. **El peso visual no vive aquí, vive en `app/globals.css`** —
 * ésa es la ley de GARDEN que H5 conserva: los tokens son variables CSS y
 * Tailwind sólo las consume. Cero hex en los componentes.
 *
 * H5 es dueño de este archivo junto con `globals.css` y `layout.tsx`.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        border: 'hsl(var(--border))',
        ring: 'hsl(var(--ring))',
      },
    },
  },
  plugins: [],
};

export default config;
