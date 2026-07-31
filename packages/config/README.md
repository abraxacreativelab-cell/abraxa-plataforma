# @abraxa/config

Entorno validado con zod y constantes de plataforma. Handoff **H1**.

```ts
import { env, HEADER, ACCESS_RANK } from '@abraxa/config';

const { SUPABASE_URL } = env();   // valida al llamarse, no al importarse
```

La validación es **perezosa a propósito**: si corriera al importar, `npm run
build` y los tests de CI reventarían por no tener secretos, y la reacción
natural sería aflojar el esquema. Así el build no necesita llaves y el runtime
sí las exige — con la lista completa de lo que falta, no de uno en uno.

Si necesitas una variable nueva, agrégala aquí y a `.env.example` **sólo si eres
H1**. Si no, anótala en tu PR.
