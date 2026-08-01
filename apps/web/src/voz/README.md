# La capa de voz

Dos endpoints y un cliente de navegador. Nada más. El producto que los usa —el Ritual, las
pantallas, el guion— es de otro carril; esto es la tubería.

- **Narrar**: texto → audio, en streaming, con caché.
- **Dictar**: audio → texto, con Groq si se puede y OpenAI si no.
- **Cliente**: `grabar()`, `narrar()`, `callar()`, permiso de micrófono.

Todo lo puro vive en `packages/auth/src/voz/` (sin Next, sin DOM, sin red). Los dos handlers
viven en `apps/web/src/voz/servidor/` y no importan nada de `next/*`, así que se prueban con un
`new Request(...)`. El cliente vive en `apps/web/src/voz/cliente.ts`.

---

## Cómo se usa desde una pantalla

```tsx
import { crearVoz, SinMicrofono, FalloDeVoz } from '@/src/voz/cliente';

const voz = crearVoz();

// ─── UNA VEZ, dentro del clic que arranca todo ─────────────────────────────
// Safari de iOS bloquea cualquier audio que no nazca de un gesto del invitado.
// Un elemento que ya sonó una vez dentro de un gesto queda libre para siempre.
// Saltarse esta línea se paga con «funciona en la laptop y en ningún iPhone».
await voz.desbloquear();

// ─── 1 · NARRAR ────────────────────────────────────────────────────────────
try {
  await voz.narrar('¿Cómo se llama tu negocio y a qué se dedica?');
} catch (e) {
  if (FalloDeVoz.es(e) && e.definitivo) apagarLaVoz(); // no lo vuelvas a intentar
  // El invitado no se entera: la pregunta ya está escrita en la pantalla.
}

// Mientras el invitado contesta, se prepara la siguiente. Cuando toque, suena
// en el milisegundo cero: medido, 0 ms contra 326 ms.
void voz.precargar('Perfecto. ¿Y cómo ganas dinero exactamente?');

// ─── 2 · DICTAR ────────────────────────────────────────────────────────────
try {
  const grabacion = await voz.grabar({ contexto: 'Cariñeeto, Inperio, ABRAXA' });
  // …el invitado habla…
  const { texto, ms, proveedor } = await grabacion.detener();
  mandarAlAgente(texto);
} catch (e) {
  if (SinMicrofono.es(e)) mostrar(e.message); // ya viene redactado, se enseña tal cual
}

// ─── Cortar ────────────────────────────────────────────────────────────────
onInvitadoEscribe(() => voz.callar()); // una voz que no se puede callar enfurece
useEffect(() => () => voz.destruir(), []); // suelta el micrófono al desmontar
```

`grabar()` llama a `callar()` sola: si el invitado empieza a hablar, la agente se calla y el
micrófono no se graba a sí mismo.

---

## Los dos endpoints

### `POST /voz/api/narrar` · `GET /voz/api/narrar?texto=…&voz=ana`

| | |
|---|---|
| Cuerpo (POST) | `{ "texto": "…", "voz": "ana" \| "cari" }` |
| Respuesta | `audio/mpeg` en **streaming** |
| Cabeceras | `x-abraxa-voz: elevenlabs \| cache`, `x-abraxa-voz-voz`, `x-abraxa-voz-modelo` |
| Tope de texto | 2000 por POST · 700 por GET (tiene que caber en la URL) |
| Timeout | 30 s |

Existen las dos formas por el iPhone: **en Safari de iOS no hay MediaSource Extensions**, así que
la única manera de que el audio empiece a sonar antes de descargarse entero es dejar que el propio
`<audio src>` haga la petición — y `<audio src>` sólo sabe hacer GET.

`voz` es `ana` por defecto: el Ritual es una entrevista y pide una voz cálida.
`ELEVENLABS_VOICE_ANA` apunta hoy a *Marcela — Colombian Girl* (español, conversacional).

**Medido en vivo el 2026-08-01, a través del handler real:**

```
1ª vez (sintetiza)   200 elevenlabs   primer byte  326 ms · completo  511 ms · 68172 bytes
2ª vez (caché)       200 cache        primer byte    1 ms · completo    1 ms · 68172 bytes
3ª vez (caché)       200 cache        primer byte    0 ms · completo    0 ms · 68172 bytes
```

El modelo es `eleven_flash_v2_5`, y no por gusto: medido contra `eleven_turbo_v2_5` con la misma
frase, 332 ms al primer byte contra 394 ms. Se cambia con `ELEVENLABS_MODEL` sin tocar código.

La caché es **por velocidad, no por ahorro** (Santiago fue explícito en que el costo no es el
criterio): las preguntas del Ritual son un guion, y el invitado número doce no debe esperar por un
audio que ya existe. Es LRU por bytes, 32 MB, en memoria del proceso. El texto se normaliza antes
de la clave, así que `"Hola.  ¿Qué tal?"` y `"  Hola.\n¿Qué tal?  "` son el mismo audio.

Si el navegador corta a media frase, **no se cachea nada**: media narración cacheada se serviría
entera y cortada para siempre.

### `POST /voz/api/transcribir`

| | |
|---|---|
| Cuerpo | `multipart/form-data` con `audio` (o `file`), y opcionalmente `idioma` y `contexto` |
| | …o el cuerpo crudo con `content-type: audio/…`, para un `curl` de diagnóstico |
| Respuesta | `{ texto, proveedor, modelo, ms, bytes, formato }` |
| Tope de audio | 15 MB (nginx corta en 25; el nuestro va antes para que el error sea JSON tipado) |
| Timeout | 45 s |
| Idioma | `es` por defecto, y se manda **explícito** |

**Agnóstico de proveedor**: si hay `GROQ_API_KEY` va por Groq (`whisper-large-v3`); si no, por
OpenAI (`whisper-1`). Funciona con o sin la de Groq. `?proveedor=openai` fuerza el respaldo para
poder comprobarlo en vivo.

**Medido en vivo el 2026-08-01, a través del handler real:**

```
m4a de Safari (iPhone)   200   558 ms   "Mi negocio organiza eventos de networking…"
webm/opus de Chrome      200   438 ms   "Mi negocio organiza eventos de networking…"
```

El idioma se manda explícito porque Whisper lo detecta solo y en audios cortos lo detecta mal: tres
palabras en español salen en portugués con total seguridad.

> **La trampa que mata el dictado.** Groq y OpenAI validan el formato por la **extensión del nombre
> de archivo**, no por el `content-type`. Medido contra Groq con el mismo webm: `audio.webm` → 200 en
> 447 ms; `audio` (sin extensión) → **400** en 90 ms, con el mensaje *«file must be one of the
> following types: [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm]»*, que no menciona la palabra
> «nombre» por ningún lado. Y `FormData.append('file', blob)` sin tercer argumento manda el nombre
> `blob`. El servidor deriva la extensión del MIME (`packages/auth/src/voz/audio.ts`) y hay pruebas
> que lo fijan; el cliente no tiene que preocuparse.

---

## Los errores: cómo degradar a texto sin que el invitado se entere

Todos salen con la forma del repo más dos banderas:

```json
{ "error": { "code": "BUDGET_EXCEEDED",
             "message": "…en español, mostrable…",
             "voz": { "reintentable": false, "definitivo": true, "proveedor": "openai" } } }
```

| `code` | HTTP | Qué es | Qué hacer |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | No hay sesión | Mandar a entrar |
| `VALIDATION` | 422 | Texto vacío, audio de 0 bytes, audio de 20 MB, silencio | Decirlo y seguir |
| `BUDGET_EXCEEDED` | 402 | Sin crédito / factura sin pagar | **Apagar la voz**. Reintentar no sirve |
| `RATE_LIMITED` | 429 | Demasiadas peticiones por minuto | Esperar y reintentar |
| `PROVIDER_ERROR` | 502 / 504 | El proveedor falló o tardó | Reintentar una vez |
| `PORT_NOT_IMPLEMENTED` | 501 | Falta la llave en este despliegue | **Apagar la voz** |

Las dos banderas son toda la decisión: `definitivo` significa «esto sólo se arregla tocando el
servidor, apaga la voz para la sesión»; `reintentable` significa «puede que a la siguiente sí».
Nunca sale un 500 desnudo, y ningún mensaje lleva una llave.

Un `429` **no siempre es un 429**: «te pasaste de peticiones» y «se te acabó el saldo» viajan los
dos así en OpenAI, y sólo el cuerpo los distingue. El primero se reintenta; al segundo se le puede
reintentar mil veces y sigue diciendo que no. Ver `packages/auth/src/voz/proveedores.ts`.

---

## Lo que hay que poner en el VPS

### 1 · Variables de entorno

Las cinco están hoy en `/Volumes/FRAGUA/CLAUDE CODE/GARDEN/.env`. **No están en el `.env` de la
Plataforma** y hay que copiarlas al del VPS. Ninguna está en el repo, y ninguna debe estarlo.

| Variable | Sin ella | Nota |
|---|---|---|
| `ELEVENLABS_API_KEY` | El producto no habla | El Ritual sigue por escrito |
| `ELEVENLABS_VOICE_ANA` | Tampoco habla | El id de la voz va en la URL, la llave sola no basta |
| `ELEVENLABS_VOICE_CARI` | Sólo se pierde la segunda voz | Opcional |
| `GROQ_API_KEY` | El dictado cae a OpenAI, notablemente más lento | **Ya existe**, no hay que crearla |
| `OPENAI_API_KEY` | Se queda sin respaldo | Hoy **sin crédito**: 429 `credit_balance_exhausted` |

Opcionales, para cambiar cosas sin tocar código: `ELEVENLABS_MODEL`, `ELEVENLABS_FORMATO`,
`GROQ_STT_MODELO`, `OPENAI_STT_MODELO`.

`diagnosticoDeVoz()` (`packages/auth/src/voz/entorno.ts`) devuelve qué falta, en español y con el
nombre de la variable y su consecuencia. Se puede llamar al arrancar.

### 2 · ⚠ Un bloque de nginx — sin esto los endpoints NO existen en producción

En el VPS, `location /api/` manda a Express (3040) y sólo `^~ /api/auth/` va a Next (3041), que es
donde viven estos dos handlers. Medido en vivo: `GET https://mi.abraxa.club/voz/api/prueba` devuelve
`{"error":{"code":"NOT_FOUND","message":"Ruta no encontrada"}}`, que es el catch-all de
`apps/api/src/app.ts:46` — o sea, Express, no Next.

Hay que añadir **antes** de `location /api/`, con la misma forma que el bloque de `/api/auth/` que ya
está ahí:

```nginx
location ^~ /voz/api/ {
    proxy_pass         http://127.0.0.1:3041;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;

    # El audio va en streaming: sin esto nginx lo acumula entero antes de
    # mandarlo y se pierden los 326 ms de arranque, que es justo lo que se
    # construyó aquí.
    proxy_buffering    off;
    proxy_read_timeout 120s;
}
```

Comprobación después del deploy (las dos tienen que dar **401 JSON**, no 404 ni 307):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://mi.abraxa.club/voz/api/narrar?texto=hola
curl -s -X POST -o /dev/null -w '%{http_code}\n' https://mi.abraxa.club/voz/api/transcribir
```

---

## Seguridad

Los dos endpoints **exigen sesión**, y está probado en tres capas
(`apps/web/src/voz/cerrado.test.ts`):

1. El **matcher** del middleware las cubre — es el fallo más silencioso posible: si una ruta se cae
   del matcher, todas las pruebas de política siguen verdes y el middleware no corre nunca.
2. La **política** (`decidir()` de `packages/auth/src/identidad.ts`) devuelve `negar` para un
   anónimo, con o sin barras de más, con o sin query.
3. El **handler** vuelve a comprobar la sesión por su cuenta y contesta 401 **sin llamar al
   proveedor** — verificado en vivo, no sólo con dobles.

El segmento `/api/` en medio de la URL es **load-bearing**: `esRutaDeDatos()` decide 401-JSON contra
307-al-login mirando si la ruta lo contiene. Si estas rutas se llamaran `/voz/narrar`, un `fetch` sin
sesión seguiría el 307, recibiría el HTML del login y reventaría en `r.json()` con un SyntaxError que
no se parece en nada a «no hay sesión».

Un invitado autenticado **sin empresa** sí puede usar la voz: es el estado de cualquiera a mitad del
Ritual, que es justo a quien más le sirve. La voz no toca un solo dato de dominio.

---

## Qué NO hay aquí

- Nada del Ritual, del guion ni de ninguna pantalla.
- Ninguna dependencia nueva. `fetch`, `FormData`, `File`, `Blob`, `ReadableStream` y
  `AbortSignal.timeout` son nativos de Node 22.
- Ninguna llave en el repo.
- Ningún `SpeechRecognition`: no existe en el Safari de iPhone, y con un iPhone llega la mitad de los
  invitados. Por eso se graba en el navegador y se transcribe en el servidor.

## Mapa de archivos

```
packages/auth/src/voz/
  errores.ts       FalloDeVoz: código, status, reintentable, definitivo
  entorno.ts       las cinco llaves + diagnosticoDeVoz()
  audio.ts         topes, MIME → extensión, validación de texto y de audio
  cache.ts         LRU por bytes, 32 MB
  proveedores.ts   arma las peticiones y traduce el «no» de cada proveedor
  index.ts

apps/web/src/voz/
  cliente.ts       crearVoz(): narrar, precargar, callar, grabar, desbloquear
  navegador.ts     el navegador como seis métodos, para poder probarlo
  servidor/
    sesion.ts      getServerSession(authOptions) — las opciones NO son opcionales
    http.ts        las respuestas, sin Next
    narrar.ts      streaming + caché
    transcribir.ts multipart + elección de proveedor + topes
  README.md        esto

apps/web/app/voz/api/narrar/route.ts        cinco líneas de pegamento
apps/web/app/voz/api/transcribir/route.ts   cinco líneas de pegamento
```
