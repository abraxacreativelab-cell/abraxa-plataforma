'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { SkeletonText } from '../primitives/skeleton';
import { EmptyState } from '../feedback/empty-state';
import { lookupTool } from './tool-registry';

/**
 * Monta el componente de una herramienta a partir de su clave.
 *
 * `ssr: false` es deliberado: las herramientas son pantallas interactivas que
 * leen datos del tenant en el cliente. Renderizarlas en el servidor sólo
 * duplicaría el trabajo y arriesgaría diferencias de hidratación.
 */
const cargando = () => <SkeletonText lines={5} className="p-6" />;

const cache = new Map<string, React.ComponentType>();

function resolver(key: string): React.ComponentType | null {
  const cacheado = cache.get(key);
  if (cacheado) return cacheado;

  const tool = lookupTool(key);
  if (!tool?.load) return null;

  const Componente = dynamic(tool.load, { ssr: false, loading: cargando });
  cache.set(key, Componente);
  return Componente;
}

export function ToolOutlet({ toolKey }: { toolKey: string }) {
  const Componente = resolver(toolKey);

  if (!Componente) {
    // En desarrollo esto es un error del constructor y tiene que doler; en
    // producción es una herramienta que la base de datos anuncia y el código
    // todavía no trae, y eso NO puede tirar la aplicación encima del cliente.
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(
        `La herramienta "${toolKey}" no tiene componente registrado.\n` +
          'El handoff dueño la registra con registerTools() desde su propio paquete.',
      );
    }
    return (
      <EmptyState
        title="Todavía no disponible"
        icon="wrench"
        description="Esta herramienta aún no está lista en tu plataforma. Va en camino."
      />
    );
  }

  return <Componente />;
}
