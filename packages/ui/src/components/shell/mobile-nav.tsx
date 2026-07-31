'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from '../primitives/icon';

export interface MobileNavProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * El cajón de navegación en pantallas chicas (criterio 7).
 *
 * Es un diálogo de Radix y no un menú a mano por tres razones que no son de
 * adorno: atrapa el foco, cierra con Escape, y devuelve el foco al botón que lo
 * abrió. Escribir eso bien a mano cuesta más de lo que parece.
 *
 * Las animaciones salen solas con `prefers-reduced-motion` — la red global de
 * `styles.css` las apaga y el diálogo sigue funcionando igual.
 */
export function MobileNav({ open, onOpenChange, children }: MobileNavProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background/75 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out data-[state=open]:fade-in motion-reduce:animate-none lg:hidden" />
        <Dialog.Content
          aria-label="Áreas de tu negocio"
          className="glass fixed inset-y-0 left-0 z-50 flex w-[min(86vw,20rem)] flex-col rounded-none p-0 shadow-2xl focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left motion-reduce:animate-none lg:hidden"
        >
          <div className="flex h-[var(--shell-topbar)] shrink-0 items-center justify-between border-b border-border/60 px-4">
            <Dialog.Title className="text-sm font-medium">Tu negocio</Dialog.Title>
            <Dialog.Close
              aria-label="Cerrar"
              className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon name="x" className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <Dialog.Description className="sr-only">
            Navega entre las áreas de tu negocio y sus herramientas.
          </Dialog.Description>

          <div className="min-h-0 flex-1">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
