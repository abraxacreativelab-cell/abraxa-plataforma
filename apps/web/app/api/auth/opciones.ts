/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `authOptions` — el contrato de identidad de toda la plataforma.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Otros carriles ya construyen contra ESTA ruta y ESTE nombre. No se mueven:
 *
 *      import { getServerSession } from 'next-auth/next';
 *      import { authOptions } from '@/app/api/auth/opciones';   // o ruta relativa
 *
 *      const s = await getServerSession(authOptions);
 *      s?.user?.email        // el correo que verificó Google
 *      s?.user?.tenantSlug   // el slug de la empresa del invitado
 *
 *  ⚠ `getServerSession()` SIN `authOptions` devuelve una sesión sin
 *  `tenantSlug`: los callbacks viven aquí, y sin opciones NextAuth usa los
 *  suyos por defecto, que sólo saben de `name`, `email` e `image`. Quien lea la
 *  sesión tiene que pasar `authOptions`.
 *
 *  ── Por qué NextAuth v4 y no v5 ────────────────────────────────────────────
 *
 *  Porque v4 es lo que está instalado (`next-auth@4.24.15`, declarado en
 *  `apps/web/package.json`) y porque v5 sigue en beta con un modelo de
 *  configuración distinto. Hoy no se estrena una beta. Las dos variables de
 *  secreto —`NEXTAUTH_SECRET` (v4) y `AUTH_SECRET` (v5)— ya están puestas con
 *  el mismo valor en el VPS, así que migrar cuando toque no rompe sesiones.
 *
 *  ── Por qué la ruta `/api/auth/*` no es negociable ─────────────────────────
 *
 *  nginx en producción tiene, ANTES del bloque general de `/api/`, un
 *  `location ^~ /api/auth/` que va al 3041 (Next). El resto de `/api/` va al
 *  3040 (Express). Montar NextAuth en cualquier otra ruta manda el callback de
 *  Google a Express, que contesta 404 — y el invitado ve "no se pudo iniciar
 *  sesión" después de haber aceptado el permiso. Está medido en producción.
 *
 *  ── Por qué sesión en JWT y no en base de datos ────────────────────────────
 *
 *  Sin adaptador: cero tablas nuevas, cero migraciones, cero latencia por
 *  petición. La identidad de la persona la lleva la cookie firmada con
 *  `NEXTAUTH_SECRET`; la MEMBRESÍA —lo que de verdad decide qué datos se ven—
 *  vive en `app.memberships` y la revalida `contextoDePeticion()` en la API en
 *  cada llamada. La cookie dice quién dices ser; la base dice qué puedes ver.
 *
 *  ── Por qué llevar `tenantSlug` en la sesión es seguro ─────────────────────
 *
 *  La cookie va firmada: el navegador no puede fabricarla ni editarla sin el
 *  secreto. Y aunque pudiera, el BFF sólo usa ese slug para ARMAR la cabecera:
 *  quien decide de verdad es `contextoDePeticion(req)` en la API, que revalida
 *  la membresía contra `TenancyPort.contextFor()` y tira 403 si no cuadra. El
 *  slug de la cabecera NUNCA se cree. Es el mismo criterio que hace que un
 *  `x-tenant-slug` forjado no sirva de nada.
 */
import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { credencialesDeGoogle, secretoDeSesion } from '../../../../../packages/auth/src/entorno';
import { puedeEntrar } from '../../../../../packages/auth/src/acceso';
import { empresaDe } from '../../../../../packages/auth/src/empresa';
import { destinoDeRedireccion } from '../../../../../packages/auth/src/redireccion';
import { transporteDeLaApi } from '../_auth/transporte';

/**
 * Lo que este carril añade a la sesión de NextAuth.
 *
 * Se declara como aumento del módulo y no como un tipo aparte para que
 * cualquier carril que haga `s?.user?.tenantSlug` lo tenga tipado sin importar
 * nada de aquí. Es aditivo: no cambia ni quita nada de lo que ya había.
 */
declare module 'next-auth' {
  interface Session {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      /** El slug de la empresa del invitado. `null` hasta que exista. */
      tenantSlug?: string | null;
      /** El nombre de esa empresa, para pintarlo sin otra consulta. */
      tenantName?: string | null;
      /** Por qué no hay empresa, cuando no la hay. Para decirlo, no para ocultarlo. */
      motivoSinEmpresa?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    tenantSlug?: string | null;
    tenantName?: string | null;
    motivoSinEmpresa?: string | null;
  }
}

/**
 * El proveedor, sólo si hay con qué.
 *
 * Sin credenciales NO se construye `GoogleProvider` con cadenas vacías: eso
 * produce un redirect a Google con `client_id=` y una pantalla de error de
 * Google, que no le dice nada a nadie. Con la lista vacía, NextAuth responde
 * su propia pantalla de "no hay proveedores configurados" y
 * `diagnosticoDeIdentidad()` explica exactamente qué falta.
 */
function proveedores(): NextAuthOptions['providers'] {
  const google = credencialesDeGoogle();
  if (!google) return [];

  return [
    GoogleProvider({
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      /**
       * `prompt: 'select_account'` y no `consent`.
       *
       * Un invitado que ya trae su cuenta abierta en el teléfono entra con un
       * toque: elige la cuenta y ya. `consent` le volvería a pedir permisos
       * cada vez —dos pantallas más— y no aporta nada: los ámbitos son `email`
       * y `profile`, que es lo mínimo y no cambia nunca.
       */
      authorization: { params: { prompt: 'select_account', scope: 'openid email profile' } },
    }),
  ];
}

interface PerfilDeGoogle {
  email_verified?: boolean;
  name?: string;
}

export const authOptions: NextAuthOptions = {
  providers: proveedores(),

  // Sin `secret` la cookie no va firmada y todo esto sería decorativo.
  // `secretoDeSesion()` acepta NEXTAUTH_SECRET o AUTH_SECRET, en ese orden.
  ...(secretoDeSesion() ? { secret: secretoDeSesion() as string } : {}),

  session: { strategy: 'jwt' },

  callbacks: {
    /**
     * La puerta de entrada a la plataforma.
     *
     * ── Por qué NO se llama a `/tenants/internal/has-access` ───────────────
     *
     * Porque rechaza a todo el mundo. `canSignIn()` (H2,
     * packages/tenancy/src/services/context.ts:195) termina en
     * `return allowed.length === 0 && env !== 'production'`, o sea: sin
     * allowlist y en producción, un correo SIN membresía previa recibe
     * `false`. Está bien para lo que fue escrita —¿este correo ya pertenece a
     * algo?— y mal como puerta de un alta self-service: un invitado nuevo, por
     * definición, todavía no pertenece a nada. Aquí la puerta es la otra: el
     * alta CREA la membresía.
     *
     * ── `email_verified` ───────────────────────────────────────────────────
     *
     * Se rechaza cuando Google dice explícitamente que NO. Si el campo no
     * viene, se deja pasar: Google lo manda siempre en su id_token, así que su
     * ausencia significa "una forma del perfil que no conocemos", no "correo
     * sin verificar" — y bloquear por eso dejaría fuera a un invitado real por
     * una suposición.
     */
    signIn({ user, profile }) {
      const perfil = profile as PerfilDeGoogle | undefined;
      if (perfil?.email_verified === false) return false;
      return puedeEntrar(user?.email);
    },

    /**
     * Aquí ocurre el alta, y sólo aquí.
     *
     * ── Por qué no corre en cada petición ─────────────────────────────────
     *
     * NextAuth v4 invoca este callback también al leer la sesión, no sólo al
     * entrar. Con `tenantSlug` ya en el token se sale en la primera línea sin
     * tocar la red: el alta pasa UNA vez por invitado y las demás peticiones
     * no pagan nada.
     *
     * ── Y por qué sí reintenta cuando falta ───────────────────────────────
     *
     * Si la API estaba caída en el segundo exacto del login, el invitado se
     * quedaría sin empresa para siempre —hasta cerrar sesión y volver a
     * entrar— por un fallo de dos segundos. Reintentar cuando falta cuesta una
     * llamada interna en el único caso en que algo ya salió mal, y hace que el
     * producto se cure solo.
     *
     * ── Por qué no lo hace el middleware ──────────────────────────────────
     *
     * Porque corre en Edge y esto necesita el secreto de proxy, `fetch` con
     * plazo y el runtime de Node. El middleware sólo LEE el token ya escrito.
     */
    async jwt({ token }) {
      const correo = typeof token.email === 'string' ? token.email.trim().toLowerCase() : '';
      if (!correo) return token;
      if (typeof token.tenantSlug === 'string' && token.tenantSlug.length > 0) return token;

      const nombre = typeof token.name === 'string' ? token.name : null;
      const r = await empresaDe(correo, nombre, transporteDeLaApi);

      if (r.estado === 'lista') {
        token.tenantSlug = r.slug;
        token.tenantName = r.nombre;
        token.motivoSinEmpresa = null;
      } else {
        token.tenantSlug = null;
        token.motivoSinEmpresa = r.motivo;
      }

      return token;
    },

    /** Lo que ven los catorce carriles. El token es la fuente; esto lo copia. */
    session({ session, token }) {
      if (session.user) {
        session.user.email = typeof token.email === 'string' ? token.email : session.user.email;
        session.user.tenantSlug = token.tenantSlug ?? null;
        session.user.tenantName = token.tenantName ?? null;
        session.user.motivoSinEmpresa = token.motivoSinEmpresa ?? null;
      }
      return session;
    },

    /** A dónde aterriza. Nunca fuera del origen — ver `redireccion.ts`. */
    redirect({ url, baseUrl }) {
      return destinoDeRedireccion(url, baseUrl);
    },
  },
};
