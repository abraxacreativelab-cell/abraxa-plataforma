/**
 * ════════════════════════════════════════════════════════════════════════════
 *  LA PRUEBA. Diez invitados, diez empresas, y ninguno ve la del otro.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Si algo de este archivo se pone rojo, el demo es un accidente en vivo. Todo
 *  lo demás del carril es comodidad; esto es el producto.
 *
 *  Cubre las DOS formas en que el aislamiento se rompe, que son distintas y no
 *  se protegen igual:
 *
 *   1. **Dos invitados acaban en la misma empresa.** Se rompe en el alta, por
 *      un slug que no depende del correo entero. La protege `slug.ts`.
 *
 *   2. **Un invitado LEE la empresa de otro.** Se rompe en la lectura, porque
 *      dos pantallas del producto resuelven quién eres con una cabecera que
 *      manda el navegador. La protege el middleware.
 *
 *  La segunda se prueba contra el archivo REAL —`apps/web/middleware.ts`, con
 *  una cookie de sesión de verdad cifrada por `next-auth/jwt`— y aplicando
 *  las cabeceras resultantes como las aplica Next por dentro. No es una
 *  imitación del middleware: es el middleware.
 *
 *  ── Por qué este archivo vive en `apps/web/src/` y no en `packages/auth` ───
 *
 *  Porque importa `next/server` y `next-auth/jwt`, y `node_modules/next/
 *  types/global.d.ts:22` declara GLOBALMENTE `readonly NODE_ENV`. En cuanto un
 *  archivo del proyecto de TypeScript de Node —el `tsconfig.json` de la raíz,
 *  que incluye los `src` de todos los paquetes— resuelve el módulo `next`,
 *  `process.env.NODE_ENV` queda de sólo lectura para TODO el programa, y las
 *  pruebas de otros nueve carriles que le escriben dejan de compilar. Medido:
 *  **67 errores** en quince archivos ajenos —57 `TS2540` y 10 `TS2704`—
 *  causados por una prueba de éste. Con las tres aquí: **0**.
 *
 *  Aquí no pasa: `apps/web` es su propio proyecto de TypeScript
 *  (`apps/web/tsconfig.json`), los tipos de Next son bienvenidos porque es una
 *  app de Next, y el proyecto de Node no lo incluye. vitest sigue recogiéndolo
 *  con el patrón que ya tenía para las apps, sin tocar `vitest.config.ts`.
 *
 *  La regla, escrita: **ningún paquete puede alcanzar los tipos de `next`.**
 *  Una prueba que necesite Next va en `apps/web/src/`. Ver `packages/auth/README.md`.
 */
import { describe, expect, it } from 'vitest';
import { encode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { ApiFalsa } from '../../../packages/auth/src/api-falsa';
import { empresaDe } from '../../../packages/auth/src/empresa';
import { slugDeCorreo } from '../../../packages/auth/src/slug';
import { middleware } from '../middleware';

const SECRETO = 'secreto-de-prueba-de-32-bytes-abcdefgh';

// ─────────────────────────────────────────────────────────────────────────────
// 1 · El alta: dos invitados, dos empresas
// ─────────────────────────────────────────────────────────────────────────────

describe('dos invitados que entran con Google', () => {
  it('quedan en empresas DISTINTAS y ninguno ve la del otro', async () => {
    const api = new ApiFalsa();

    const ana = await empresaDe('ana@gmail.com', 'Ana Ruiz', api.transporte);
    const beto = await empresaDe('beto@gmail.com', 'Beto Sol', api.transporte);

    expect(ana.estado).toBe('lista');
    expect(beto.estado).toBe('lista');
    if (ana.estado !== 'lista' || beto.estado !== 'lista') return;

    expect(ana.slug).not.toBe(beto.slug);
    expect(ana.creada).toBe(true);
    expect(beto.creada).toBe(true);

    // Y lo que de verdad importa: lo que cada uno puede LISTAR.
    const deAna = await api.transporte({
      ruta: '/tenants/mine',
      metodo: 'GET',
      correo: 'ana@gmail.com',
    });
    const deBeto = await api.transporte({
      ruta: '/tenants/mine',
      metodo: 'GET',
      correo: 'beto@gmail.com',
    });

    expect(slugsDe(deAna)).toEqual([ana.slug]);
    expect(slugsDe(deBeto)).toEqual([beto.slug]);
    expect(slugsDe(deAna)).not.toContain(beto.slug);
    expect(slugsDe(deBeto)).not.toContain(ana.slug);
  });

  /**
   * El caso que rompe la versión ingenua, y el que va a pasar en el evento:
   * dos personas cuyo correo empieza igual. En un grupo de diez invitados hay
   * dos "info@", dos "hola@" o dos con el mismo nombre casi seguro.
   */
  it('con la MISMA parte local y dominios distintos, tampoco chocan', async () => {
    const api = new ApiFalsa();

    const uno = await empresaDe('info@constructora.mx', 'Constructora', api.transporte);
    const dos = await empresaDe('info@panaderia.mx', 'Panadería', api.transporte);

    expect(uno.estado).toBe('lista');
    expect(dos.estado).toBe('lista');
    if (uno.estado !== 'lista' || dos.estado !== 'lista') return;

    expect(uno.slug).not.toBe(dos.slug);
    expect(api.tenants).toHaveLength(2);
    expect(api.tenants.map((t) => t.owner).sort()).toEqual([
      'info@constructora.mx',
      'info@panaderia.mx',
    ]);
  });

  it('diez invitados dan diez empresas, sin una sola colisión', async () => {
    const api = new ApiFalsa();
    const correos = [
      'ana@gmail.com',
      'ana@outlook.com',
      'ana.ruiz@gmail.com',
      'info@a.mx',
      'info@b.mx',
      'santiago@abraxa.club',
      'Santiago@Abraxa.Club', // el mismo, con otras mayúsculas
      'j@x.io',
      'contacto+demo@gmail.com',
      'ünïcode@dominio.mx',
    ];

    const resultados = [];
    for (const c of correos) resultados.push(await empresaDe(c, null, api.transporte));

    expect(resultados.every((r) => r.estado === 'lista')).toBe(true);

    // Nueve empresas y no diez: el séptimo correo es el sexto con otras
    // mayúsculas, y tiene que caer en la MISMA empresa. Volver a entrar no
    // estrena una empresa vacía.
    expect(api.tenants).toHaveLength(9);

    const slugs = api.tenants.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('volver a entrar mañana cae en la misma empresa, no en una nueva', async () => {
    const api = new ApiFalsa();

    const primera = await empresaDe('ana@gmail.com', 'Ana Ruiz', api.transporte);
    const segunda = await empresaDe('ana@gmail.com', 'Ana Ruiz', api.transporte);

    if (primera.estado !== 'lista' || segunda.estado !== 'lista') throw new Error('sin empresa');

    expect(segunda.slug).toBe(primera.slug);
    expect(segunda.creada).toBe(false);
    expect(api.tenants).toHaveLength(1);
  });

  /**
   * El slug que ya es de otro. No debería ocurrir —la huella lo hace
   * improbabilísimo— y aun así se resuelve, porque el día del evento no se
   * depura una colisión: se entra.
   */
  it('si el slug ya es de otra persona, el invitado entra igual con otro slug', async () => {
    const api = new ApiFalsa();
    const ocupado = slugDeCorreo('ana@gmail.com');
    api.tenants.push({ slug: ocupado, name: 'De otra persona', owner: 'otra@gmail.com' });
    api.membresias.push({
      slug: ocupado,
      email: 'otra@gmail.com',
      role: 'owner',
      status: 'active',
    });

    const ana = await empresaDe('ana@gmail.com', 'Ana Ruiz', api.transporte);

    expect(ana.estado).toBe('lista');
    if (ana.estado !== 'lista') return;
    expect(ana.slug).not.toBe(ocupado);

    const suyas = await api.transporte({
      ruta: '/tenants/mine',
      metodo: 'GET',
      correo: 'ana@gmail.com',
    });
    expect(slugsDe(suyas)).toEqual([ana.slug]);
  });

  it('si listar falla, se da de alta igual — y sigue sin duplicar', async () => {
    const api = new ApiFalsa();
    const primera = await empresaDe('ana@gmail.com', 'Ana Ruiz', api.transporte);

    api.falloEn = { ruta: '/tenants/mine', status: 500 };
    const segunda = await empresaDe('ana@gmail.com', 'Ana Ruiz', api.transporte);

    if (primera.estado !== 'lista' || segunda.estado !== 'lista') throw new Error('sin empresa');
    expect(segunda.slug).toBe(primera.slug);
    expect(api.tenants).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · La lectura: la cabecera forjada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Copia VERBATIM de cómo resuelven la identidad las dos pantallas del producto.
 *
 *   apps/web/app/(app)/ajustes/plan/_lib/datos.ts:41-42   (H16)
 *   apps/web/app/(app)/contactos/datos.ts:42-43           (H15)
 *
 * No se importan sus módulos porque arrastran `next/headers` y `@abraxa/ui`
 * —React incluido— al proyecto de TypeScript de Node, y `contrato.test.ts`
 * comprueba contra el código fuente que estas dos líneas siguen siendo las
 * suyas. Si H15 o H16 cambian de cabecera, aquella prueba se pone roja y ésta
 * deja de mentir.
 */
function loQueVeLaPantalla(h: Headers): { correo: string; empresa: string } | null {
  const correo = h.get('x-abraxa-session-email');
  const empresa = h.get('x-abraxa-session-tenant');
  if (!correo || !empresa) return null;
  return { correo, empresa };
}

/**
 * Aplica la respuesta del middleware a la petición, como hace Next por dentro.
 *
 * Réplica de `node_modules/next/dist/server/lib/router-utils/resolve-routes.js`
 * líneas 353-378: las cabeceras que NO estén en `x-middleware-override-headers`
 * se BORRAN de la petición, y las que estén se reemplazan por su
 * `x-middleware-request-*`. Sin este paso la prueba estaría comprobando lo que
 * el middleware devuelve, no lo que la pantalla acaba viendo.
 */
function aplicarOverrides(entrantes: Headers, respuesta: Response): Headers {
  const lista = respuesta.headers.get('x-middleware-override-headers');
  if (lista === null) return new Headers(entrantes);

  const permitidas = new Set(
    lista
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  );

  const salida = new Headers();
  for (const clave of permitidas) {
    const valor = respuesta.headers.get(`x-middleware-request-${clave}`);
    if (valor !== null) salida.set(clave, valor);
  }
  return salida;
}

async function cookieDeSesion(correo: string, tenantSlug: string | null): Promise<string> {
  const jwt = await encode({
    token: { email: correo, name: correo, ...(tenantSlug ? { tenantSlug } : {}) },
    secret: SECRETO,
  });
  return `next-auth.session-token=${jwt}`;
}

function peticion(ruta: string, cabeceras: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost:3000${ruta}`, { headers: cabeceras });
}

describe('la cabecera forjada', () => {
  // Cookie sin `__Secure-`: el middleware deduce el nombre de NEXTAUTH_URL.
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.NEXTAUTH_SECRET = SECRETO;

  it('un anónimo que forja la cabecera NO renderiza los datos de esa empresa', async () => {
    const entrantes = {
      'x-abraxa-session-email': 'victima@otra.com',
      'x-abraxa-session-tenant': 'empresa-de-la-victima',
    };

    // Sin middleware, esto es lo que la pantalla vería. Es el ataque.
    expect(loQueVeLaPantalla(new Headers(entrantes))).toEqual({
      correo: 'victima@otra.com',
      empresa: 'empresa-de-la-victima',
    });

    const res = await middleware(peticion('/contactos', entrantes));

    /*
     * Con el arreglo, la petición NUNCA llega a la pantalla: se contesta un
     * 307 a la entrada y ahí se acaba. Por eso lo que se afirma es que no se
     * renderizó nada — no que las cabeceras salieran limpias, que en un
     * redirect ni siquiera viajan.
     *
     * Que las cabeceras se limpien EN LAS RUTAS QUE SÍ RENDERIZAN es lo que
     * comprueban las otras pruebas de este bloque, incluida la de una ruta
     * pública, que es el caso en el que un anónimo sí llega a un Server
     * Component.
     */
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/api/auth/signin');
    expect(res.headers.get('location')).toContain(encodeURIComponent('/contactos'));

    // Y no se coló ni una sola cabecera de identidad hacia el render.
    expect(res.headers.get('x-middleware-request-x-abraxa-session-email')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-abraxa-session-tenant')).toBeNull();
  });

  it('un anónimo que forja la cabecera contra una ruta de DATOS recibe 401', async () => {
    const res = await middleware(
      peticion('/bandeja/api/hilos', {
        'x-abraxa-session-email': 'victima@otra.com',
        'x-abraxa-session-tenant': 'empresa-de-la-victima',
      }),
    );

    expect(res.status).toBe(401);
    // 401 y no 307: un `fetch` que sigue un redirect recibe HTML y el
    // `await r.json()` del otro lado revienta con un error que no se parece a
    // "no hay sesión".
    expect(await res.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Necesitas iniciar sesión.' },
    });
  });

  it('un invitado CON sesión que forja las cabeceras de otro, ve las SUYAS', async () => {
    const cookie = await cookieDeSesion('beto@gmail.com', 'beto-empresa');

    const req = peticion('/contactos', {
      cookie,
      // Beto, ya dentro, intenta leer la empresa de Ana.
      'x-abraxa-session-email': 'ana@gmail.com',
      'x-abraxa-session-tenant': 'ana-empresa',
    });

    const res = await middleware(req);
    const vistas = aplicarOverrides(req.headers, res);

    expect(res.status).toBe(200);
    expect(loQueVeLaPantalla(vistas)).toEqual({
      correo: 'beto@gmail.com',
      empresa: 'beto-empresa',
    });
  });

  it('también borra las cabeceras del contrato BFF→API', async () => {
    const cookie = await cookieDeSesion('beto@gmail.com', 'beto-empresa');

    const req = peticion('/contactos', {
      cookie,
      'x-user-email': 'ana@gmail.com',
      'x-tenant-slug': 'ana-empresa',
      'x-proxy-secret': 'el-secreto-que-me-inventé',
    });

    const vistas = aplicarOverrides(req.headers, await middleware(req));

    expect(vistas.get('x-user-email')).toBeNull();
    expect(vistas.get('x-tenant-slug')).toBeNull();
    expect(vistas.get('x-proxy-secret')).toBeNull();
  });

  it('en una ruta PÚBLICA también las borra', async () => {
    const req = peticion('/', {
      'x-abraxa-session-email': 'victima@otra.com',
      'x-abraxa-session-tenant': 'empresa-de-la-victima',
    });

    const res = await middleware(req);
    const vistas = aplicarOverrides(req.headers, res);

    expect(res.status).toBe(200);
    expect(loQueVeLaPantalla(vistas)).toBeNull();
  });

  it('una cookie firmada con OTRO secreto no acredita nada', async () => {
    const falsificada = await encode({
      token: { email: 'ana@gmail.com', tenantSlug: 'ana-empresa' },
      secret: 'otro-secreto-distinto-de-32-bytes-xyz',
    });

    const req = peticion('/contactos', {
      cookie: `next-auth.session-token=${falsificada}`,
    });

    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(loQueVeLaPantalla(aplicarOverrides(req.headers, res))).toBeNull();
  });

  it('una sesión sin empresa deja el correo y NO inventa una empresa', async () => {
    const cookie = await cookieDeSesion('nuevo@gmail.com', null);

    const req = peticion('/ritual', {
      cookie,
      'x-abraxa-session-tenant': 'empresa-de-la-victima',
    });

    const vistas = aplicarOverrides(req.headers, await middleware(req));

    expect(vistas.get('x-abraxa-session-email')).toBe('nuevo@gmail.com');
    expect(vistas.get('x-abraxa-session-tenant')).toBeNull();
    expect(loQueVeLaPantalla(vistas)).toBeNull();
  });

  /**
   * El caso del comentario de `cabeceras.ts`: la cabecera repetida.
   *
   * `Headers` de la plataforma junta los valores repetidos con coma, así que
   * `h.get()` devuelve `"victima@otra.com, beto@gmail.com"`. Un `set` sin
   * `delete` previo lo dejaría intacto en algún camino, y el primer valor
   * —el del atacante— es el que se leería.
   */
  it('la cabecera mandada DOS veces tampoco se cuela', async () => {
    const cookie = await cookieDeSesion('beto@gmail.com', 'beto-empresa');

    const crudas = new Headers({ cookie });
    crudas.append('x-abraxa-session-email', 'victima@otra.com');
    crudas.append('x-abraxa-session-email', 'otra-victima@otra.com');

    const req = new NextRequest('http://localhost:3000/contactos', { headers: crudas });
    const vistas = aplicarOverrides(req.headers, await middleware(req));

    expect(vistas.get('x-abraxa-session-email')).toBe('beto@gmail.com');
  });
});

function slugsDe(r: { cuerpo: unknown }): string[] {
  const cuerpo = r.cuerpo as { tenants?: { slug: string }[] } | null;
  return (cuerpo?.tenants ?? []).map((t) => t.slug);
}
