/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Castellano de cliente — la aduana entre nuestra jerga y su pantalla
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Del ensayo del 2026-08-01, hallazgo 5: CINCO pantallas le hablaban al
 *  cliente en jerga interna. Textual de lo que se vio en vivo:
 *
 *      «Falta: H2 · packages/tenancy»
 *      «El módulo de sesión y empresa (H2) todavía no está registrado»
 *      «packages/crm está construido… por el contrato de no colisión»
 *      «sus migraciones 130–132 están escritas»
 *      «Falta cablear la ruta (H18).»
 *
 *  Un invitado no sabe qué es H2. Lo único que lee es que el producto está a
 *  medio hacer y que quien se lo enseña no se molestó en traducirlo.
 *
 *  ── Por qué esto vive en la ADUANA y no en cada pantalla ───────────────────
 *
 *  Porque las cinco pantallas son de cinco carriles distintos y ninguna es de
 *  H5. Arreglarlas una por una es cinco PRs, cinco revisiones y la certeza de
 *  que la sexta vuelve a aparecer la semana que entra.
 *
 *  En cambio TODAS pasan por un componente de `@abraxa/ui` para pintar ese
 *  texto —`EmptyState`, `LoadError`, `LockedArea`, `SidebarArea`,
 *  `TarjetaDeArea`—, y esos sí son de H5. Así que la traducción se hace en el
 *  borde: da igual quién escriba la frase, no llega cruda al invitado.
 *
 *  ── Reemplazo ENTERO, no borrado quirúrgico ────────────────────────────────
 *
 *  La tentación es tachar las palabras técnicas y dejar el resto. Es peor:
 *  «Falta: H2 · packages/tenancy» tachado queda en «Falta:», que no dice nada y
 *  además se ve roto. Una frase a medias es más humillante que una en jerga.
 *
 *  Así que la regla es binaria: si la frase trae UN marcador técnico, se cambia
 *  ENTERA por una que sí se puede leer, y la original se manda al log del
 *  servidor —que es donde sirve, y donde la busca quien puede arreglarla.
 *
 *  ── El falso positivo que sí importa ───────────────────────────────────────
 *
 *  Estas frases llevan dentro el nombre que el emprendedor le puso a su agente
 *  («Chica Guapa termine contigo El bautizo»). Si un marcador se disparara con
 *  un nombre propio, el producto le borraría su frase por llamarle a su agente
 *  como se le dio la gana.
 *
 *  Por eso NO hay regla de PascalCase suelto. `TenancyPort` sólo cuenta cuando
 *  va pegado a un `.` o a un `(` —o sea, cuando es una llamada y no un
 *  nombre—, y todos los demás marcadores son formas que el castellano no
 *  produce: rutas con `/`, `snake_case`, códigos de carril `H12`, extensiones
 *  de archivo. Un agente que se llame «Lupita», «McDonalds» o «AbraXa» pasa
 *  intacto. Está verificado en `castellano.test.ts`.
 */

/**
 * Los marcadores. Cada uno es una forma que el castellano de negocio NO
 * produce, y cada uno está atado en las pruebas a la frase real que lo
 * justifica: si alguien afloja una regla, se cae la prueba que dice qué
 * pantalla vuelve a filtrar jerga.
 */
const MARCADORES: readonly { nombre: string; re: RegExp }[] = [
  // «H2», «(H18)», «H2 · packages/tenancy». El código de carril, con o sin
  // paréntesis. Dos dígitos como mucho: `H2O` o `H1B` no cuentan.
  { nombre: 'carril', re: /(^|[^A-Za-z0-9])H\d{1,2}(?![A-Za-z0-9])/ },

  // Rutas del repositorio: `packages/crm`, `apps/web/app/(app)/…`, `src/lib`.
  { nombre: 'ruta', re: /(^|[^A-Za-z0-9])(packages|apps|src|scripts|migrations|node_modules)\// },

  // Cualquier archivo con extensión, con o sin número de línea: `session.ts:119`.
  { nombre: 'archivo', re: /[A-Za-z0-9_-]+\.(ts|tsx|js|mjs|cjs|json|sql|css|md)\b/ },

  // `snake_case` y `SCREAMING_SNAKE`: `tenant_areas`, `PORT_NOT_IMPLEMENTED`.
  { nombre: 'identificador', re: /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/ },

  // Una llamada de código: `contextFor()`, `TenancyPort.contextFor`,
  // `getServerSession(authOptions)`. Exige el `.` o el `(` justo después, que
  // es lo que la distingue de un nombre propio.
  { nombre: 'llamada', re: /\b[A-Za-z][A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*\s*[.(]/ },

  // «migración 130», «migraciones 130–132». El guion largo también.
  { nombre: 'migración', re: /\bmigraci[oó]n(es)?\s+\d/i },

  // Vocabulario de taller. Ninguna de estas palabras existe en el castellano
  // que usa un emprendedor para hablar de su negocio.
  {
    nombre: 'jerga',
    re: /\b(handoff|handoffs|carril|carriles|merge|mergear|commit|branch|deploy|endpoint|port|ports|mock|stub|payload|backend|frontend|hardcode\w*|cablear|cableado|cablead[ao]s?|TODO|null|undefined|NaN|bug)\b/i,
  },

  // Flechas y operadores que sólo salen de un diagnóstico.
  { nombre: 'operador', re: /(→|=>|::|&&|\|\||\$\{)/ },
];

/**
 * ¿Esta frase trae jerga interna?
 *
 * Se expone porque las pruebas de otros carriles la van a querer: es la forma
 * barata de que un PR no vuelva a filtrar «H2 · packages/tenancy» a producción.
 */
export function tieneJerga(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return MARCADORES.some((m) => m.re.test(texto));
}

/** Qué marcadores se dispararon. Para el log, no para la pantalla. */
export function marcadoresDeJerga(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return MARCADORES.filter((m) => m.re.test(texto)).map((m) => m.nombre);
}

/**
 * El respaldo por defecto. Es la frase honesta y completa: dice que no es culpa
 * suya, dice qué va a pasar, y no promete una fecha que nadie firmó.
 */
export const RESPALDO_SIN_JERGA =
  'estamos terminando de construirla — es cosa nuestra, no tuya, y aquí te avisamos';

/**
 * La frase, en castellano de cliente.
 *
 * Si venía limpia, se devuelve tal cual. Si traía jerga, se cambia entera por
 * `respaldo` y la original se deja en el log del servidor.
 *
 * `null` entra y `null` sale: una frase que no existe no se inventa. Un
 * componente que recibe `undefined` tiene que poder seguir sin pintar nada, no
 * pintar una disculpa que nadie pidió.
 */
export function sinJerga<T extends string | null | undefined>(
  texto: T,
  respaldo: string = RESPALDO_SIN_JERGA,
): T extends string ? string : T {
  type Salida = T extends string ? string : T;

  if (typeof texto !== 'string' || texto.trim().length === 0) return texto as Salida;
  if (!tieneJerga(texto)) return texto as Salida;

  avisar(texto);
  return respaldo as Salida;
}

/**
 * El diagnóstico NO se pierde: se manda al log, que es donde lo busca quien
 * puede hacer algo con él.
 *
 * En producción se calla. No por vergüenza: un `console.warn` por render en el
 * servidor de producción es ruido que entierra los errores de verdad, y esta
 * clase de defecto se atrapa en desarrollo y en el CI —donde `tieneJerga()` es
 * una aserción— mucho antes de que llegue a un cliente.
 */
function avisar(texto: string): void {
  if (process.env.NODE_ENV === 'production') return;
  console.warn(
    `[@abraxa/ui] Jerga interna interceptada antes de llegar al cliente ` +
      `(${marcadoresDeJerga(texto).join(', ')}): «${texto}»\n` +
      'La frase se reemplazó por la de respaldo. Escríbela en castellano de cliente ' +
      'en el archivo que la produce y el reemplazo deja de ocurrir solo.',
  );
}
