/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Los paquetes de `packages/*` se consumen como FUENTE TypeScript.
   * Next los compila; nadie mantiene un paso de build por paquete.
   *
   * H1 ya listó los 12. Si tu paquete ya está aquí, no hay nada que configurar.
   */
  transpilePackages: [
    '@abraxa/config',
    '@abraxa/db',
    '@abraxa/tenancy',
    '@abraxa/agents',
    '@abraxa/vault',
    '@abraxa/ui',
    '@abraxa/inbox',
    '@abraxa/onboarding',
    '@abraxa/flows',
    '@abraxa/work',
    '@abraxa/billing',
    '@abraxa/areas',
  ],

  eslint: {
    // El lint corre una vez, en la raíz, con la misma config para todo el
    // monorepo. Que `next build` lo repita con otras reglas sólo confunde.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
