/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El handler de NextAuth. Cuatro líneas y una ruta que no se mueve.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Atiende TODO `/api/auth/*`: la pantalla de entrada, el arranque de OAuth, el
 *  callback de Google, la sesión, el CSRF y el cierre de sesión.
 *
 *  ── La URI de redirección, exacta ──────────────────────────────────────────
 *
 *      https://mi.abraxa.club/api/auth/callback/google
 *
 *  Está registrada así en Google Cloud Console y la compone NextAuth a partir
 *  de `NEXTAUTH_URL` + esta ruta. Cambiar cualquiera de las dos rompe el login
 *  con `redirect_uri_mismatch`, que Google enseña en su propia pantalla y que
 *  no se puede diagnosticar desde aquí.
 *
 *  ── Runtime de Node, no Edge ───────────────────────────────────────────────
 *
 *  El callback de `jwt` da de alta la empresa llamando a `apps/api` con el
 *  secreto de proxy. Eso quiere `process.env` y `fetch` con plazo del lado del
 *  servidor. NextAuth v4 no corre en Edge de todos modos, pero decirlo aquí
 *  evita que un cambio de default de Next lo mueva sin que nadie lo note.
 *
 *  ── `force-dynamic` ────────────────────────────────────────────────────────
 *
 *  Nada de esto se cachea jamás. Sin esto, `next build` intenta prerenderizar
 *  la ruta y falla al leer cookies durante la compilación.
 */
import NextAuth from 'next-auth';
import { authOptions } from '../opciones';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
