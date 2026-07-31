# H14 — Panel de agencia

> **Ola 3.** Corre en paralelo con H11, H12 y H13. Requiere H1, H2, H3 y H5 mergeados.
> Rama: `h14-admin` · Migraciones: `110`–`119`
> Directorio: `apps/web/app/(admin)/**`

---

## 1. Contexto

El panel para **ti y tu equipo**, no para los clientes. Desde aquí se ve el estado de todos los
tenants, se da soporte, se vigila el consumo de IA y se atrapan los problemas antes de que el
emprendedor los reporte.

Es lo que hace posible operar 50 clientes sin que se te caiga el negocio encima.

---

## 2. Alcance

### Sí

1. **Lista de tenants** con salud, plan, consumo y última actividad.
2. **Ficha de tenant**: sus áreas, sus agentes, sus canales, su gasto.
3. **Consumo de IA** por tenant y agregado, con alertas.
4. **Alta manual** de un tenant (sin pasar por Stripe).
5. Suplantación para soporte, **auditada**.
6. Salud del sistema: canales caídos, workflows fallando, webhooks con error.

### No

- **No** toques ningún `packages/*`. Consumes las APIs que ya existen.
- **No** el cobro. Es H10 — tú lo lees.
- **No** edites datos de negocio de un cliente sin suplantación auditada.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `apps/web/app/(admin)/**` |
| **Migraciones** | `110`–`119` |
| **Rama** | `h14-admin` · worktree `PLATAFORMA-h14-admin` |

**Consumes:** todo, vía las APIs de los demás paquetes. **No implementas ningún port.**

---

## 4. Acceso

Sólo correos en `CORE_ADMIN_EMAILS`. **Fail-closed**: sin la variable configurada, **nadie
entra** — ni siquiera tú. Es el patrón de `GARDEN/garden-os/app/api/auth/check/route.ts:17-18` y
está bien: una variable perdida en un deploy no puede abrir el panel de administración.

El acceso a `/(admin)` se verifica **server-side**, no escondiendo botones.

---

## 5. Suplantación — la función peligrosa

Necesitarás entrar como un cliente para darle soporte. Tres reglas:

1. **Todo queda auditado**: quién, a qué tenant, cuándo, cuánto duró.
2. **Se ve en la UI del cliente** que hay un admin dentro. Sin ventanas de un solo sentido.
3. **Expira sola** — 30 minutos, no una sesión abierta para siempre.

```sql
-- 110_admin.sql
CREATE TABLE app.impersonation_log (
  id          bigserial PRIMARY KEY,
  admin_email text NOT NULL,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  reason      text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
```

---

## 6. El tablero que de verdad sirve

No hagas un dashboard bonito de métricas de vanidad. Haz el que te dice **qué está roto ahora**:

| Panel | Responde |
|---|---|
| **Necesita atención** | canales desconectados · workflows fallando · webhooks con error · tenants sin actividad en 7 días |
| **Consumo de IA** | gasto de hoy vs promedio, por tenant. **Alerta al 80% del presupuesto** de cada plan |
| **Altas recientes** | quién entró, si terminó el onboarding, dónde se quedó |
| **Salud** | latencia, errores, colas atascadas |

**El dato que más vale:** en qué fase del Ritual de Fundación se atoran los emprendedores. Si
todos abandonan en la fase 3, ahí está tu problema de producto — y esa es la métrica que
convierte el panel en una herramienta de aprendizaje, no de vigilancia.

**Honestidad en los números:** si una fuente falla, muestra "—", nunca un cero. Un cero falso
te hace tomar decisiones equivocadas. GARDEN acertó en esto (`app/empresas`); consérvalo.

---

## 7. Criterios observables de "listo"

1. Ver los tenants con su estado real, ordenables por consumo y por última actividad.
2. Dar de alta un tenant **manualmente** y que funcione igual que uno de Stripe.
3. Suplantar a un cliente, y que quede **auditado, visible para él, y expire solo**.
4. Un canal desconectado aparece en "necesita atención" **antes** de que el cliente lo reporte.
5. El consumo por tenant cuadra con `usage_ledger`.
6. Alerta al 80% del presupuesto de un plan.
7. Sin `CORE_ADMIN_EMAILS`, nadie entra.
8. Una fuente caída muestra "—", nunca cero.

---

## 8. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1, H2, H3 y H5 hayan mergeado.
  test -f packages/db/ports.ts && test -d packages/tenancy/src && test -d packages/agents/src \
    && test -d packages/ui/src && echo LISTO || echo "ESPERA"
Si falta alguno, NO crees estructura. Lee tu handoff, prepara tu plan.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h14-admin (tu worktree, rama
h14-admin ya activa). No hagas checkout ni switch.

Vas a construir H14 — el panel de agencia de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H14-admin.md         (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)

Contexto: es el panel para el equipo de ABRAXA, no para los clientes. Es lo que hace posible
operar 50 clientes sin que el negocio se te caiga encima.

Escribes SÓLO en apps/web/app/(admin)/**. No toques ningún packages/* — consumes las APIs que
los otros handoffs ya expusieron. Migraciones 110–119. Otras 3 conversaciones en paralelo.

Tres cosas importan más que las demás:

1. Acceso fail-closed: sin CORE_ADMIN_EMAILS configurado, NADIE entra — ni tú. Una variable
   perdida en un deploy no puede abrir el panel de administración. Verificación server-side,
   no esconder botones.

2. La suplantación es la función peligrosa. Tres reglas: queda auditada, SE VE en la UI del
   cliente que hay un admin dentro, y expira sola a los 30 minutos. Nada de ventanas de un
   solo sentido.

3. No hagas un dashboard de métricas de vanidad. Haz el que dice QUÉ ESTÁ ROTO AHORA: canales
   caídos, workflows fallando, webhooks con error. Y el dato que más vale de todos: en qué fase
   del Ritual de Fundación se atoran los emprendedores. Si todos abandonan en la fase 3, ahí
   está el problema de producto.

Honestidad en los números: si una fuente falla, muestra "—", nunca un cero. Un cero falso lleva
a decisiones equivocadas.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
