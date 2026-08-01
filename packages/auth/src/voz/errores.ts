/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El fallo de voz, tipado. Para que quien llama pueda degradar a texto.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La capa de voz es un ADORNO caro: cuando funciona, el invitado siente que el
 *  producto le habla; cuando no, tiene que poder seguir escribiendo sin
 *  enterarse de que algo se rompió. Eso sólo es posible si el error dice QUÉ
 *  pasó con suficiente precisión como para decidir sin adivinar:
 *
 *    · «no hay llave configurada»      → no lo vuelvas a intentar en toda la
 *                                        sesión: apaga la voz y ya.
 *    · «el proveedor no tiene crédito» → lo mismo, y avísale a quien opera.
 *    · «el proveedor va lento»         → reintenta una vez.
 *    · «el texto venía vacío»          → es un bug de quien llama.
 *
 *  Un `500 Internal Server Error` no permite ninguna de las cuatro. Por eso
 *  aquí no hay ni un 500 desnudo.
 *
 *  ── Por qué estos códigos y no otros ───────────────────────────────────────
 *
 *  Son un SUBCONJUNTO de `PlatformErrorCode` (packages/db/ports.ts), el
 *  vocabulario de errores del repo entero. No se inventa uno nuevo: el cliente
 *  de la bandeja, el del Ritual y éste hablan el mismo idioma, y el `status`
 *  sale de la misma tabla de `packages/db/src/errors.ts`.
 *
 *  `voz/errores.test.ts` lo comprueba EN TIEMPO DE COMPILACIÓN contra el tipo
 *  real de `@abraxa/db`, para que el día que alguien renombre un código, esto
 *  falle en CI y no en el evento.
 *
 *  ── Por qué no se usa `PlatformError` directamente ─────────────────────────
 *
 *  Porque este módulo es PURO —igual que el resto de `packages/auth`— y
 *  `@abraxa/db` arrastra el cliente de Postgres. Un módulo que sólo decide qué
 *  decirle a alguien no necesita una conexión a la base para hacerlo.
 */

/** Los únicos códigos que sale de esta capa. Subconjunto de `PlatformErrorCode`. */
export type CodigoDeVoz =
  /** No hay sesión. Nadie sin identidad gasta tokens de nadie. */
  | 'UNAUTHENTICATED'
  /** Lo que mandó quien llama no sirve: texto vacío, audio de 0 bytes, MIME desconocido. */
  | 'VALIDATION'
  /** El proveedor se quedó sin crédito o sin pagar. Reintentar NO lo arregla. */
  | 'BUDGET_EXCEEDED'
  /** Límite de peticiones por minuto. Reintentar SÍ lo arregla. */
  | 'RATE_LIMITED'
  /** El proveedor contestó mal, o no contestó. */
  | 'PROVIDER_ERROR'
  /** No hay llave configurada en este despliegue: la capacidad no existe aquí. */
  | 'PORT_NOT_IMPLEMENTED';

/**
 * Código → status HTTP. La MISMA tabla de `packages/db/src/errors.ts:3-15`.
 *
 * Se copia en vez de importarse por la razón de arriba —pureza— y la prueba
 * comprueba que no se separen. Ocho líneas duplicadas con un test que las ata
 * cuestan menos que un paquete de base de datos dentro del runtime del BFF.
 */
const STATUS: Record<CodigoDeVoz, number> = {
  UNAUTHENTICATED: 401,
  VALIDATION: 422,
  BUDGET_EXCEEDED: 402,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  PORT_NOT_IMPLEMENTED: 501,
};

/**
 * ¿Tiene sentido volver a intentarlo?
 *
 * No es decorativo: es lo que separa «espera dos segundos y reintenta» de
 * «apaga la voz para toda la sesión». Con `BUDGET_EXCEEDED` marcado como
 * reintentable, un cliente educado martillearía a un proveedor que va a decir
 * que no las mil veces.
 */
const REINTENTABLE: ReadonlySet<CodigoDeVoz> = new Set<CodigoDeVoz>([
  'RATE_LIMITED',
  'PROVIDER_ERROR',
]);

/**
 * `true` cuando el fallo es DEFINITIVO para este despliegue.
 *
 * Quien llama apaga la voz y no la vuelve a encender hasta que alguien toque el
 * servidor. Es el caso de «falta la llave» y el de «no hay crédito»: los dos se
 * arreglan en la consola de un proveedor o en el `.env` del VPS, nunca solos.
 */
const DEFINITIVO: ReadonlySet<CodigoDeVoz> = new Set<CodigoDeVoz>([
  'PORT_NOT_IMPLEMENTED',
  'BUDGET_EXCEEDED',
]);

export interface CuerpoDeFallo {
  error: {
    code: CodigoDeVoz;
    message: string;
    /** Pistas para el cliente. Nunca lleva nada del proveedor ni de la llave. */
    voz: { reintentable: boolean; definitivo: boolean; proveedor?: string };
  };
}

/**
 * Un fallo de la capa de voz.
 *
 * Lleva `status` porque el handler lo devuelve tal cual, y `proveedor` porque
 * «Groq va lento» y «ElevenLabs no está pagado» se leen distinto en un log a
 * las once de la noche.
 */
export class FalloDeVoz extends Error {
  readonly code: CodigoDeVoz;
  readonly status: number;
  readonly reintentable: boolean;
  readonly definitivo: boolean;
  readonly proveedor?: string;

  constructor(
    code: CodigoDeVoz,
    message: string,
    opciones?: { proveedor?: string; cause?: unknown; status?: number },
  ) {
    super(message, opciones?.cause !== undefined ? { cause: opciones.cause } : undefined);
    this.name = 'FalloDeVoz';
    this.code = code;
    // El `status` se puede forzar sólo para decir la verdad con más precisión:
    // un timeout es PROVIDER_ERROR, pero 504 se lee mejor que 502 en un log de
    // nginx. Nunca para inventar un código nuevo.
    this.status = opciones?.status ?? STATUS[code];
    this.reintentable = REINTENTABLE.has(code);
    this.definitivo = DEFINITIVO.has(code);
    if (opciones?.proveedor) this.proveedor = opciones.proveedor;
  }

  static es(e: unknown): e is FalloDeVoz {
    return e instanceof FalloDeVoz;
  }

  /** El cuerpo que viaja por HTTP. Nunca filtra la llave ni el `cause`. */
  cuerpo(): CuerpoDeFallo {
    return {
      error: {
        code: this.code,
        message: this.message,
        voz: {
          reintentable: this.reintentable,
          definitivo: this.definitivo,
          ...(this.proveedor ? { proveedor: this.proveedor } : {}),
        },
      },
    };
  }
}

/**
 * Lee un `CuerpoDeFallo` que vino por la red, con desconfianza.
 *
 * El cliente de navegador la usa para reconstruir el fallo tipado desde el JSON
 * del endpoint. Tiene que aguantar que le llegue cualquier cosa: un 502 de
 * nginx en HTML, un cuerpo vacío, un `{}`. En todos esos casos devuelve un
 * `PROVIDER_ERROR` genérico en vez de reventar — porque reventar aquí sería
 * convertir «la voz falló» en «la pantalla se rompió».
 */
export function falloDesdeCuerpo(cuerpo: unknown, status: number): FalloDeVoz {
  const e =
    typeof cuerpo === 'object' && cuerpo !== null && 'error' in cuerpo
      ? (cuerpo as { error?: unknown }).error
      : null;
  const objeto = typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : null;

  const code = objeto?.code;
  const message = objeto?.message;
  const conocido = typeof code === 'string' && code in STATUS;

  return new FalloDeVoz(
    conocido ? (code as CodigoDeVoz) : 'PROVIDER_ERROR',
    typeof message === 'string' && message.trim().length > 0
      ? message
      : `La voz no contestó bien (HTTP ${status}).`,
    { status },
  );
}
