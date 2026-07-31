# H13 — Drivers de email y SMS

> **Ola 3.** Corre en paralelo con H11, H12 y H14. Requiere H1 y H6 mergeados.
> Rama: `h13-email-sms` · Migraciones: `105`–`109`
> Directorios: `packages/inbox/drivers/email/**` y `packages/inbox/drivers/sms/**` — nada más

---

## 1. Contexto

Completas la bandeja unificada. Email para lo formal —cotizaciones, contratos, seguimiento— y
SMS para lo urgente: recordatorios de cita, confirmaciones, códigos.

Además, tu driver de email **desbloquea el nodo `send_email` del constructor de
automatizaciones**, que hoy es un stub. En GARDEN devuelve `skipped` literal
(`src/crm/workflows/engine.ts:275-277`).

---

## 2. Alcance

### Sí

1. **Email saliente** por Resend.
2. **Email entrante** por IMAP o webhook, con threading correcto.
3. **SMS** por Twilio, bidireccional.
4. Manejo de rebotes, quejas y bajas.

### No

- **No** toques nada fuera de tus dos carpetas de driver.
- **No** construyas campañas masivas de correo. Eso es otro carril.
- **No** plantillas con diseño. Sólo el transporte.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/inbox/drivers/email/**` y `packages/inbox/drivers/sms/**` |
| **Migraciones** | `105`–`109` |
| **Rama** | `h13-email-sms` · worktree `PLATAFORMA-h13-email-sms` |

**Implementas:** `ChannelDriver` para `email` y `sms`.

---

## 4. Email — lo que lo hace difícil

WhatsApp es un chat. El correo no, y ahí es donde fallan las integraciones apresuradas:

**Threading.** Hay que respetar `Message-ID`, `In-Reply-To` y `References`. Si no, cada
respuesta abre un hilo nuevo y la bandeja se vuelve un basurero. Guarda el `Message-ID` de cada
mensaje saliente y úsalo como `In-Reply-To` al responder.

**Entregabilidad.** El dominio necesita **SPF, DKIM y DMARC** verificados. Recomienda un
subdominio dedicado (`mail.abraxa.club`) para no arriesgar el correo que el emprendedor ya usa.
Sin esto, todo cae en spam y el emprendedor cree que el producto no sirve.

**Rebotes y quejas.** Un `hard bounce` marca la dirección como inválida y **deja de intentar**.
Una queja de spam es una baja inmediata y permanente. Ignorar esto quema la reputación del
dominio para todos los tenants a la vez.

**Citas y firmas.** El correo entrante trae la cadena completa citada abajo. Recórtala antes de
guardar o cada mensaje pesa diez veces lo que dice.

```sql
-- 105_email_sms.sql
CREATE TABLE app.suppressions (
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  channel_type text NOT NULL,
  address     text NOT NULL,
  reason      text NOT NULL,   -- hard_bounce | complaint | unsubscribe | manual
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel_type, address)
);
ALTER TABLE app.suppressions ENABLE ROW LEVEL SECURITY;
```

**Antes de cada envío se consulta esta tabla.** Sin excepción, en email y en SMS.

---

## 5. SMS — corto, caro y regulado

**Registro A2P.** En México mandar SMS comerciales exige registro de remitente con documentos
de la empresa. Es de Santiago y tiene su propio tiempo. **Puedes construir y probar con números
de prueba de Twilio** mientras llega.

**Costo por mensaje.** A diferencia de WhatsApp, cada SMS cuesta. Segmenta bien: 160 caracteres
en GSM-7, 70 si hay emoji o acentos raros (UCS-2). **Avísale al emprendedor cuántos segmentos
va a mandar antes de enviar**, o le va a llegar una factura que no esperaba.

**Baja obligatoria.** "Responde BAJA para no recibir más." Procesa esa respuesta
automáticamente hacia `suppressions`. No es opcional.

**El agente contesta SMS igual que en los demás canales**, pero con presupuesto de caracteres.
Un agente que manda tres segmentos por respuesta es caro. Pásale esa restricción en el prompt.

---

## 6. Criterios observables de "listo"

1. Mandar un correo desde la bandeja y que **llegue a la bandeja de entrada, no a spam**
   (verifica con un dominio verificado real).
2. Responder ese correo desde fuera y que **aparezca en el mismo hilo**, no en uno nuevo.
3. El agente contesta un correo entrante.
4. Un `hard bounce` escribe en `suppressions` y el siguiente envío a esa dirección **no se
   intenta**.
5. Mandar y recibir un SMS real.
6. "BAJA" da de baja automáticamente.
7. Antes de enviar un SMS largo, la UI dice **cuántos segmentos** son.
8. El nodo `send_email` de H8 **deja de devolver `skipped`** y manda de verdad.
9. Las citas del correo entrante se recortan.

---

## 7. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1 y H6 hayan mergeado.
  test -f packages/db/ports.ts && test -d packages/inbox/src && echo LISTO || echo "ESPERA"
Si falta alguno, NO crees estructura. Lee tu handoff, prepara tu plan.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h13-email-sms (tu worktree, rama
h13-email-sms ya activa). No hagas checkout ni switch.

Vas a construir H13 — los drivers de email (Resend + IMAP) y SMS (Twilio) para
ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H13-email-sms.md     (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (implementas ChannelDriver para email y sms)
  packages/inbox/src/drivers/registry.ts   (donde te enchufas — NO lo edites)

Contexto: completas la bandeja unificada. Email para lo formal, SMS para lo urgente. Y tu
driver de email desbloquea el nodo send_email del constructor de automatizaciones, que hoy es
un stub que devuelve 'skipped' literal.

Escribes SÓLO en packages/inbox/drivers/email/** y packages/inbox/drivers/sms/**. Todo el
resto de packages/inbox/ es de H6. Migraciones 105–109. Otras 3 conversaciones en paralelo.

Lo que hace difícil al email y donde fallan las integraciones apresuradas:
  - Threading: respeta Message-ID, In-Reply-To y References, o cada respuesta abre un hilo
    nuevo y la bandeja se vuelve un basurero.
  - Entregabilidad: SPF, DKIM y DMARC verificados o todo cae en spam y el emprendedor cree que
    el producto no sirve.
  - Rebotes y quejas: un hard bounce deja de intentarse; una queja es baja permanente. Ignorar
    esto quema la reputación del dominio para TODOS los tenants a la vez.
  - Recorta las citas del correo entrante o cada mensaje pesa diez veces lo que dice.

Y en SMS: cada mensaje cuesta. Avísale al emprendedor cuántos segmentos va a mandar ANTES de
enviar, o le llega una factura que no esperaba. "BAJA" se procesa automáticamente.

Puedes construir y probar con números de prueba de Twilio mientras llega el registro A2P.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
