# H12 — Driver de Instagram y Messenger

> **Ola 3.** Corre en paralelo con H11, H13 y H14. Requiere H1 y H6 mergeados,
> **y que la app de Meta esté aprobada** (dependencia externa, no la controlamos).
> Rama: `h12-meta` · Migraciones: `100`–`104`
> Directorio: `packages/inbox/drivers/meta/**` — **y nada más**

---

## 1. Contexto

Para muchos negocios mexicanos, Instagram **es** el canal de ventas. El DM es donde preguntan
precio, donde se cierra y donde se pierde el cliente si nadie contesta a tiempo.

Tú conectas Instagram y Messenger a la bandeja unificada que construyó H6, para que el agente
del emprendedor conteste ahí igual que en WhatsApp.

**Ojo:** en GARDEN estos canales **no existen** — son literalmente strings en un `type union`
con cero código detrás. Construyes desde cero contra una interfaz que ya existe.

---

## 2. Alcance

### Sí

1. Driver de **Instagram Direct**.
2. Driver de **Messenger** (Facebook Pages).
3. Webhook de Meta con verificación de firma.
4. Flujo de conexión: el emprendedor vincula su cuenta desde Ajustes.
5. Manejo de la **ventana de 24 horas** de Meta.

### No

- **No** toques nada fuera de `packages/inbox/drivers/meta/`. El núcleo del inbox es de H6.
- **No** publiques contenido ni gestiones anuncios. Sólo mensajería.
- **No** modifiques el registro de drivers. H6 lo dejó — tú te enchufas.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/inbox/drivers/meta/**` |
| **Migraciones** | `100`–`104` |
| **Rama** | `h12-meta` · worktree `PLATAFORMA-h12-meta` |

⚠️ **Este es el carril más estrecho de todos.** H6 es dueño de `packages/inbox/**` **excepto**
tu carpeta. Si escribes fuera, el gate de CI falla el PR nombrando el archivo.

**Implementas:** `ChannelDriver` (de `packages/db/ports.ts`), tipos `instagram` y `messenger`.

---

## 4. Dependencia externa — léela antes de empezar

Necesitas de Santiago, y **no depende de qué tan rápido construyas**:

- App de Meta tipo Business creada y vinculada a su Business Suite
- Permisos aprobados: `instagram_manage_messages`, `pages_messaging`, `pages_manage_metadata`
- **Verificación de negocio** (documentos fiscales)
- **App Review** aprobada
- App ID, App Secret y token de acceso de página

**Puedes construir y probar sin la aprobación**: Meta permite probar con cuentas de desarrollador
y roles de prueba. Arranca con eso y valida contra producción cuando la aprobación llegue.

---

## 5. Lo que hace distinto a Meta

Tres cosas que no aplican a WhatsApp y que hay que resolver bien:

**La ventana de 24 horas.** Sólo puedes responder libremente dentro de las 24 h posteriores al
último mensaje del usuario. Fuera de eso hacen falta etiquetas de mensaje aprobadas.
**Consecuencia de diseño:** guarda `last_inbound_at` por hilo y **marca en la UI cuándo la
ventana se está cerrando**. Que el emprendedor lo vea, no que se entere por un error.

**Un solo webhook para todo.** Meta manda mensajes de IG y de Messenger al mismo endpoint.
Discrimina por `object` (`instagram` vs `page`) y rutea.

**Identidad distinta.** El usuario de IG no trae teléfono, trae un `sender.id` opaco por página.
El mismo humano puede ser un teléfono en WhatsApp y un handle en IG. Escribe en
`contact_identities` (`{ contact_id, channel_type, address }`) y **no intentes fusionar
contactos automáticamente** — proponerlo sí, fusionar solo no. Un merge equivocado revuelve dos
clientes y eso no se deshace fácil.

---

## 6. Reglas del webhook

1. **Verifica `X-Hub-Signature-256`** con el App Secret. Siempre.
2. **Responde 200 rápido**; procesa después. Meta reintenta agresivo.
3. **Idempotencia por `mid`** — el índice único de `messages.external_id` de H6 ya lo cubre.
4. **Ignora tus propios ecos** (`is_echo: true`) o vas a contestar tus propios mensajes.
5. El challenge de verificación (`hub.challenge`) tiene que responder en texto plano.

---

## 7. Criterios observables de "listo"

1. Mandar un DM de Instagram a la cuenta conectada y que **el agente conteste**.
2. Lo mismo por Messenger.
3. Ambos aparecen en la **misma bandeja** que WhatsApp, distinguibles por canal.
4. Un webhook reenviado no duplica el mensaje.
5. Un eco propio **no** dispara respuesta.
6. Fuera de la ventana de 24 h, la UI lo indica **antes** de que el envío falle.
7. El mismo humano en dos canales queda con dos identidades ligadas al contacto, **sin fusión
   automática**.
8. Firma inválida → rechazado y registrado.

---

## 8. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1 y H6 hayan mergeado.
  test -f packages/db/ports.ts && test -d packages/inbox/src && echo LISTO || echo "ESPERA"
Si falta alguno, NO crees estructura. Lee tu handoff, prepara tu plan.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h12-meta (tu worktree, rama
h12-meta ya activa). No hagas checkout ni switch.

Vas a construir H12 — los drivers de Instagram Direct y Messenger para ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H12-meta.md          (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (implementas ChannelDriver)
  packages/inbox/src/drivers/registry.ts   (donde te enchufas — NO lo edites)

Contexto: para muchos negocios mexicanos Instagram ES el canal de ventas. El DM es donde
preguntan precio, donde se cierra y donde se pierde el cliente si nadie contesta a tiempo.

En GARDEN estos canales NO existen — son literalmente strings en un type union con cero código
detrás. Construyes desde cero, pero contra una interfaz que H6 ya dejó lista.

TU CARRIL ES EL MÁS ESTRECHO DE TODOS: escribes SÓLO en packages/inbox/drivers/meta/**.
H6 es dueño de todo el resto de packages/inbox/. Si escribes fuera, el gate de CI falla el PR.
Migraciones 100–104. Otras 3 conversaciones trabajan en paralelo.

Tres cosas que hacen a Meta distinto de WhatsApp y hay que resolver bien:
  1. La ventana de 24 horas. Guarda last_inbound_at y MUESTRA en la UI cuándo se está cerrando
     — que el emprendedor lo vea, no que se entere por un error.
  2. Un solo webhook para IG y Messenger: discrimina por 'object' y rutea.
  3. Identidad: el usuario de IG no trae teléfono. Escribe en contact_identities y NO fusiones
     contactos automáticamente — proponerlo sí, fusionar solo no. Un merge equivocado revuelve
     dos clientes y no se deshace fácil.

Puedes construir y probar sin la aprobación de Meta usando cuentas de desarrollador y roles de
prueba. Arranca con eso.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
