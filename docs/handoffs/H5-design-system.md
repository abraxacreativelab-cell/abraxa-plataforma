# H5 — Design system, shell y navegación por áreas

> **Ola 1.** Corre en paralelo con H2, H3 y H4. Requiere que H1 esté mergeado.
> Rama: `h5-design-system` · Sin migraciones
> Directorios: `packages/ui/**`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css`

---

## 1. Contexto

Tú defines cómo se ve y se siente todo el producto, y construyes el esqueleto por donde los
otros 13 handoffs cuelgan sus pantallas. Si tu trabajo es bueno, cada handoff sólo escribe su
contenido y todo se ve coherente sin coordinarse.

**Lo que hay que conservar de GARDEN:** su lenguaje visual ya está resuelto y es bueno — negro
frío, cristal, acento contextual. **Lo que hay que cambiar:** el acento se elegía por *empresa
del portafolio ABRAXA*; aquí se elige **por área del negocio del emprendedor**.

---

## 2. Alcance

### Sí

1. Tokens de color, tipografía y espaciado.
2. Componentes base reutilizables.
3. **Acento contextual por área**, con contraste AA garantizado.
4. El **shell**: sidebar, header, layout del producto.
5. **Navegación cargada desde base de datos**, no del código.
6. Estados vacíos y de error honestos.

### No

- **No** construyas pantallas de dominio. Cada handoff hace la suya dentro de su route group.
- **No** toques ningún `packages/*` que no sea `ui`.
- **No** definas el contenido de las áreas. Eso es H11.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/ui/**`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css` |
| **Migraciones** | ninguna |
| **Rama** | `h5-design-system` |

⚠️ **No entres a `apps/web/app/(app)/direccion/`, `(app)/bandeja/`, `(onboarding)/`,
`(app)/tareas/`, `(app)/automatizaciones/`, `(app)/mapa/`, `(public)/` ni `(admin)/`.** Son de
otros handoffs. Tú das el `layout.tsx` raíz y el shell; ellos llenan su carpeta.

---

## 4. Qué portar de GARDEN

GARDEN está en `/Volumes/FRAGUA/CLAUDE CODE/GARDEN`. **Consulta, no edites.**

| Archivo | Líneas | Qué llevarte |
|---|---|---|
| `garden-os/app/globals.css` | 372 | **Todo el sistema de tokens.** El peso visual vive aquí, no en Tailwind |
| `garden-os/lib/brand.ts` | 164 | **`accentVars()`** — convierte hex a HSL y **sube la luminosidad en bucle hasta garantizar WCAG AA ≥4.5:1**. Vacía `COMPANY_BRAND` y `AUTHOR_BRAND`: son las empresas de Santiago |
| `garden-os/components/ui/*` | 212 | `button`, `card`, `badge`, `input`, `select-native`, `separator` |
| `garden-os/components/vault/vault-shell.tsx` | 77 | El shell que **carga las áreas de la DB** |
| `garden-os/components/vault/tool-registry.tsx` | 81 | Mapea `"area:herramienta"` → componente con `dynamic(ssr:false)`. **Tiene un guard en dev que lanza si una clave registrada no tiene componente** — consérvalo |
| `garden-os/components/vault/vault-icon.tsx` | 60 | 24 iconos lucide mapeados por nombre string (necesario porque el icono viene de la DB) |
| `garden-os/components/empty-state.tsx` | 62 | `EmptyState` y **`LoadError`** — distinguen "no tienes nada" de "falló la carga, reintenta" |
| `garden-os/components/sidebar.tsx` + `liquid-menu.css` | 360+ | El menú con gota líquida. **Opcional** — bonito pero no crítico |

---

## 5. La ley visual

De `GARDEN/docs/VAULT-II-DISENO.md`, y sigue vigente:

> **Blanco luminoso primario · negro FRÍO · acento CONTEXTUAL.**

- Base **acromática**: fondo `222 28% 3.8%` (negro azulado, no negro puro), texto `210 24% 97%`
- **`--primary`, `--accent`, `--ring` y `--glow` son UN MISMO token**. Cambiar uno recolorea todo
- Vidrio: `.glass` y `.holo` con `backdrop-filter: blur(14px) saturate(1.15)`
- **Cero hex en los componentes.** Todo por token
- **Estados semánticos FIJOS**: success, warning, error, info **no siguen el acento**. Como decía
  el comentario original: *"'activo' no puede volverse rojo dentro de Rito"*

---

## 6. Acento por área — el cambio de fondo

En GARDEN el acento se elegía por empresa del portafolio. **Aquí el usuario tiene una sola
empresa**, así que el acento distingue **áreas de su negocio**:

| Área | Acento sugerido |
|---|---|
| Ventas / Marketing | verde crecimiento |
| Dirección | dorado / ámbar |
| Onboarding | azul |
| Servicio al cliente | cian |
| RH | violeta |
| Finanzas | esmeralda |

**El emprendedor puede sobrescribir su color de marca** en Ajustes, y ese color se vuelve el
acento global. Por eso `accentVars()` importa tanto: acepta **cualquier** hex que él elija y
**garantiza el contraste** subiendo la luminosidad hasta cumplir AA. Si alguien pone amarillo
neón, el texto sigue siendo legible. Esa función es lo mejor del design system de GARDEN.

```tsx
<div data-accent style={accentVars(colorDelArea)}>…</div>
```

---

## 7. Navegación desde base de datos — lo que hace posible la gamificación

**El sidebar no está en el código.** Se carga de la DB, porque cada emprendedor tiene áreas
distintas y las va desbloqueando.

```
GET /areas → [{ slug, label, icon, position, state, access, tools[] }]
```

`state` puede ser `bloqueada | disponible | en_progreso | activa`. **Las áreas bloqueadas se
muestran con candado y su promesa** — la curiosidad es el motor del producto, así que no las
escondas.

H11 llena esos datos. Tú consumes el endpoint y renderizas. Mientras H11 no exista, usa un
mock con las cuatro áreas de v1.

**`tool-registry`**: mapea `"ventas:contactos"` → componente, con carga dinámica. Cada handoff
registra sus herramientas en su propio archivo dentro de su carpeta — así nadie edita un
registro central.

---

## 8. Estados vacíos y errores honestos

GARDEN acertó en algo que hay que conservar: **distinguir "no tienes nada" de "falló la carga"**.
Un `0` cuando en realidad la petición murió es una mentira que le cuesta confianza al producto.

- `EmptyState` — "aún no tienes contactos" + acción para crear el primero
- `LoadError` — "no pudimos cargar esto" + botón de reintentar

Nunca un spinner eterno. Nunca un cero falso.

---

## 9. Criterios observables de "listo"

1. `apps/web` arranca y el shell renderiza con navegación mock.
2. Cambiar el acento de un área recolorea toda la subárbol **sin tocar un solo hex**.
3. **`accentVars()` con un color de bajo contraste** (prueba con `#333333` y con `#ffff00`)
   produce texto legible: verifica el ratio ≥ 4.5:1 en ambos casos.
4. Los estados semánticos **no** cambian con el acento: `success` sigue verde dentro de un área
   roja.
5. Un área en estado `bloqueada` se ve con candado y su promesa, y **no es clickeable**.
6. `LoadError` aparece cuando el endpoint falla, y `EmptyState` cuando devuelve vacío. Son
   distinguibles a simple vista.
7. Responsive real: el sidebar colapsa en móvil sin romper el contenido.
8. `prefers-reduced-motion` respetado en toda animación.

---

## 10. Prompt de arranque

```
Vas a construir H5 — el design system, el shell y la navegación de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H5-design-system.md  (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)

Contexto: defines cómo se ve todo el producto y construyes el esqueleto donde los otros 13
handoffs cuelgan sus pantallas. Si lo haces bien, cada uno sólo escribe su contenido y todo se
ve coherente sin que se coordinen entre sí.

GARDEN está en "/Volumes/FRAGUA/CLAUDE CODE/GARDEN" — consúltalo, NO lo edites. Su lenguaje
visual ya está resuelto y es bueno; llévatelo:
  garden-os/app/globals.css      (372 líneas, todo el sistema de tokens)
  garden-os/lib/brand.ts         (accentVars() garantiza contraste WCAG AA automáticamente)
  garden-os/components/ui/*      (6 componentes base)
  garden-os/components/vault/vault-shell.tsx + tool-registry.tsx  (nav desde DB)
  garden-os/components/empty-state.tsx  (EmptyState vs LoadError)

El cambio de fondo respecto a GARDEN: allá el acento se elegía por empresa del portafolio
ABRAXA. Aquí el usuario tiene UNA sola empresa, así que el acento distingue ÁREAS de su
negocio — y él puede sobrescribirlo con su color de marca. Por eso accentVars() es la pieza
clave: acepta cualquier hex y garantiza legibilidad subiendo la luminosidad hasta cumplir AA.

Trabajas SÓLO en packages/ui/**, apps/web/app/layout.tsx y apps/web/app/globals.css.
NO entres a ningún route group — (app)/direccion, (app)/bandeja, (onboarding), etc. son de
otros handoffs. Tú das el layout raíz y el shell; ellos llenan su carpeta.
Rama h5-design-system. Sin migraciones. Otras 3 conversaciones trabajan en paralelo.

Conserva dos reglas de GARDEN que están bien: cero hex en componentes (todo por token), y los
estados semánticos (success/warning/error) NO siguen el acento — "activo" no puede volverse
rojo dentro de un área roja.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
