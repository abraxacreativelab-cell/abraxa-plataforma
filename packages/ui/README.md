# @abraxa/ui

Design system, shell y navegación por áreas.

| | |
|---|---|
| **Handoff** | H5 |
| **Rama** | `h5-design-system` |
| **También tuyos** | `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/(app)/layout.tsx` |

`apps/web` ya lo trae en `transpilePackages`: puedes escribir TSX con
`'use client'` sin configurar nada.

No entres a ningún route group de dominio — `(app)/direccion`, `(app)/bandeja`,
`(onboarding)`, `(public)`, `(admin)` son de otros handoffs.
