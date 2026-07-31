/**
 * Un servidor HTTP de verdad para las pruebas.
 *
 * Levanta el router de H2 igual que lo monta `apps/api` — mismo prefijo, mismo
 * manejador de errores — y le habla por la red con `fetch`. Sin dependencias
 * nuevas: Node 22 trae `fetch` y express ya está instalado.
 *
 * Importa que sea HTTP real y no una llamada directa al middleware: la prueba
 * de aislamiento tiene que ejercitar el camino completo — headers, orden de
 * middlewares, serialización de la respuesta — porque es ahí donde vive el
 * error que uno teme. Un `contextFor()` correcto no sirve de nada si el router
 * lo monta después de la ruta que debía proteger.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { PlatformError } from '@abraxa/db';
import { HEADER } from '@abraxa/config';
import { router } from '../routes/index';

export interface RespuestaPrueba {
  status: number;
  body: unknown;
  texto: string;
}

export interface ClientePrueba {
  pedir(
    metodo: string,
    ruta: string,
    opciones?: { email?: string | null; slug?: string | null; body?: unknown; secreto?: string },
  ): Promise<RespuestaPrueba>;
  cerrar(): Promise<void>;
}

/** Monta el router como lo hace apps/api y devuelve un cliente que le habla. */
export async function levantarApi(): Promise<ClientePrueba> {
  const app = express();
  app.use(express.json());

  // Mismo prefijo que `MOUNTS` de apps/api/src/packages.ts.
  app.use('/tenants', router);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
  });

  // Mismo manejador central que apps/api/src/app.ts.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (PlatformError.is(err)) {
      res.status(err.status).json(err.toResponse());
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  return {
    async pedir(metodo, ruta, opciones = {}) {
      const headers: Record<string, string> = {};

      // `undefined` = no mandar el header. `null` = mandarlo vacío.
      if (opciones.email !== undefined && opciones.email !== null) {
        headers[HEADER.userEmail] = opciones.email;
      }
      if (opciones.slug !== undefined && opciones.slug !== null) {
        headers[HEADER.tenantSlug] = opciones.slug;
      }
      if (opciones.secreto !== undefined) headers[HEADER.proxySecret] = opciones.secreto;
      if (opciones.body !== undefined) headers['content-type'] = 'application/json';

      const res = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers,
        ...(opciones.body !== undefined ? { body: JSON.stringify(opciones.body) } : {}),
      });

      const texto = await res.text();
      let body: unknown = null;
      try {
        body = texto ? JSON.parse(texto) : null;
      } catch {
        body = texto;
      }
      return { status: res.status, body, texto };
    },

    cerrar: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
