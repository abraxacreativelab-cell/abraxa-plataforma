/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La FORMA de la sesión. Dos carriles dependen de ella.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  H7 (el Ritual) y H6 (la bandeja) resuelven en qué empresa está el invitado
 *  leyendo `user.tenantSlug`, cada uno por su camino:
 *
 *    · H6 importa `authOptions` y llama a `getServerSession(authOptions)`.
 *    · H7 llama por HTTP a `GET /api/auth/session` con la cookie de la
 *      petición, para no acoplarse a un módulo que puede no existir todavía.
 *
 *  Los dos caminos pasan por el MISMO sitio: `callbacks.session` de
 *  `apps/web/app/api/auth/opciones.ts`. El endpoint `/api/auth/session` no es
 *  otra cosa: es el handler de NextAuth corriendo con estas mismas opciones y
 *  serializando lo que este callback devuelve.
 *
 *  Por eso esta prueba mira el callback y no el endpoint: es la misma verdad,
 *  sin levantar un servidor. La comprobación con el servidor de verdad —un
 *  `curl` contra `/api/auth/session`— está en el PR, y es la que descarta que
 *  el JSON se pierda algo por el camino.
 *
 *  Si alguien quita `tenantSlug` de aquí en un refactor, dos carriles se quedan
 *  sin saber de quién son los datos que están pintando, y se descubre en vivo.
 *
 *  Vive en `apps/web/src/` porque importa `authOptions`, que importa
 *  `next-auth`: los tipos de Next declaran `readonly NODE_ENV` de forma GLOBAL
 *  y meterlos en el proyecto de TypeScript de Node rompe las pruebas de otros
 *  seis carriles. La explicación completa está en `aislamiento.test.ts` y en
 *  `packages/auth/README.md`.
 */
import { describe, expect, it } from 'vitest';
import type { JWT } from 'next-auth/jwt';
import type { Session } from 'next-auth';
import { authOptions } from '../app/api/auth/opciones';

/** La sesión tal y como la arma NextAuth antes de llamar al callback. */
const sesionCruda = (correo: string): Session => ({
  user: { name: 'Ana Ruiz', email: correo, image: null },
  expires: '2099-01-01T00:00:00.000Z',
});

async function sesionResuelta(token: JWT): Promise<Session> {
  const cb = authOptions.callbacks?.session;
  if (!cb) throw new Error('authOptions no define callbacks.session');

  return cb({
    session: sesionCruda(String(token.email ?? '')),
    token,
    // El resto del argumento sólo lo usa la estrategia de base de datos, que
    // este carril no usa. Se pasa vacío con un cast acotado en vez de fingir
    // un usuario y una cuenta que nunca van a existir.
  } as unknown as Parameters<NonNullable<typeof cb>>[0]);
}

describe('la forma de la sesión — el contrato con H6 y H7', () => {
  it('trae email y tenantSlug', async () => {
    const s = await sesionResuelta({
      email: 'ana@gmail.com',
      tenantSlug: 'ana-ruiz-1a2b3c4d',
      tenantName: 'Ana Ruiz',
    } as JWT);

    expect(s.user?.email).toBe('ana@gmail.com');
    expect(s.user?.tenantSlug).toBe('ana-ruiz-1a2b3c4d');
    expect(s.user?.tenantName).toBe('Ana Ruiz');
  });

  /**
   * `tenantSlug: null` y no ausente.
   *
   * `JSON.stringify` borra los `undefined`, así que un `undefined` aquí hace
   * que la clave DESAPAREZCA del JSON de `/api/auth/session` — y H7, que lee
   * ese JSON por HTTP, no puede distinguir "todavía no tiene empresa" de "este
   * endpoint no conoce el campo". Con `null` la clave viaja y la diferencia se
   * lee.
   */
  it('sin empresa, tenantSlug viaja como null y NO desaparece del JSON', async () => {
    const s = await sesionResuelta({ email: 'nuevo@gmail.com' } as JWT);

    expect(s.user?.tenantSlug).toBeNull();
    expect(Object.keys(JSON.parse(JSON.stringify(s)).user)).toContain('tenantSlug');
  });

  it('cuando el alta falló, dice por qué en vez de callarse', async () => {
    const s = await sesionResuelta({
      email: 'nuevo@gmail.com',
      motivoSinEmpresa: 'La API respondió 401 al dar de alta la empresa.',
    } as JWT);

    expect(s.user?.tenantSlug).toBeNull();
    expect(s.user?.motivoSinEmpresa).toContain('401');
  });

  it('el correo del TOKEN manda sobre el de la sesión', async () => {
    const s = await sesionResuelta({ email: 'real@gmail.com', tenantSlug: 'x-1a2b3c4d' } as JWT);
    expect(s.user?.email).toBe('real@gmail.com');
  });
});

describe('authOptions', () => {
  it('usa JWT y no base de datos: cero tablas, cero migraciones', () => {
    expect(authOptions.session?.strategy).toBe('jwt');
    expect(authOptions.adapter).toBeUndefined();
  });

  it('define los cuatro callbacks de los que cuelga todo', () => {
    expect(authOptions.callbacks?.signIn).toBeTypeOf('function');
    expect(authOptions.callbacks?.jwt).toBeTypeOf('function');
    expect(authOptions.callbacks?.session).toBeTypeOf('function');
    expect(authOptions.callbacks?.redirect).toBeTypeOf('function');
  });

  /**
   * Sin credenciales de Google la lista de proveedores queda VACÍA, y eso es
   * lo correcto: NextAuth responde su propia pantalla de "no hay proveedores"
   * en vez de mandar al invitado a Google con `client_id=` y una pantalla de
   * error de Google que no le dice nada a nadie.
   *
   * En el VPS las dos variables ya están puestas, así que ahí la lista trae a
   * Google. Aquí, en CI, no — y la prueba tiene que valer en los dos casos.
   */
  it('sólo ofrece Google cuando hay credenciales', () => {
    const hay = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    expect(authOptions.providers.length).toBe(hay ? 1 : 0);
    if (hay) expect(authOptions.providers[0]?.id).toBe('google');
  });
});

describe('signIn — la puerta de entrada', () => {
  const entrar = async (correo: string | null, emailVerified?: boolean) => {
    const cb = authOptions.callbacks?.signIn;
    if (!cb) throw new Error('authOptions no define callbacks.signIn');
    return cb({
      user: { id: 'x', email: correo, name: null, image: null },
      account: null,
      ...(emailVerified === undefined ? {} : { profile: { email_verified: emailVerified } }),
    } as unknown as Parameters<NonNullable<typeof cb>>[0]);
  };

  it('deja entrar a cualquier cuenta de Google cuando no hay allowlist', async () => {
    delete process.env.AUTH_ALLOWED_EMAILS;
    expect(await entrar('quien.sea@gmail.com')).toBe(true);
  });

  it('rechaza si Google dice que el correo NO está verificado', async () => {
    delete process.env.AUTH_ALLOWED_EMAILS;
    expect(await entrar('quien.sea@gmail.com', false)).toBe(false);
  });

  it('acepta cuando Google sí lo verificó', async () => {
    delete process.env.AUTH_ALLOWED_EMAILS;
    expect(await entrar('quien.sea@gmail.com', true)).toBe(true);
  });

  it('rechaza sin correo', async () => {
    expect(await entrar(null)).toBe(false);
  });

  it('con allowlist, sólo esa lista', async () => {
    process.env.AUTH_ALLOWED_EMAILS = 'santiago@abraxa.club';
    expect(await entrar('santiago@abraxa.club')).toBe(true);
    expect(await entrar('otro@gmail.com')).toBe(false);
    delete process.env.AUTH_ALLOWED_EMAILS;
  });
});

describe('redirect — a dónde aterriza el invitado', () => {
  const ir = async (url: string): Promise<string> => {
    const cb = authOptions.callbacks?.redirect;
    if (!cb) throw new Error('authOptions no define callbacks.redirect');
    return cb({ url, baseUrl: 'https://mi.abraxa.club' });
  };

  it('sin destino concreto, al Ritual', async () => {
    expect(await ir('https://mi.abraxa.club')).toBe('https://mi.abraxa.club/ritual');
  });

  it('con destino, ahí', async () => {
    expect(await ir('/contactos')).toBe('https://mi.abraxa.club/contactos');
  });

  it('nunca fuera del origen', async () => {
    expect(await ir('https://mi-abraxa.club/robo')).toBe('https://mi.abraxa.club/ritual');
  });
});
