import type { Metadata } from 'next';
import { Pantalla } from './pantalla';

export const metadata: Metadata = { title: 'Automatizaciones · ABRAXA Plataforma' };

/**
 * `/automatizaciones` — describirlo en español y verlo correr paso por paso.
 *
 * La pantalla es de CLIENTE porque su razón de ser es el movimiento: el lienzo
 * se edita, la corrida avanza sola. Los datos entran por el BFF de `api/`, que
 * corre en el servidor y es el único que ve la sesión.
 *
 * `puedeActivar` viaja desde aquí y no se decide en el navegador. Hoy es
 * `false` porque todavía no hay sesión (la entrega H18): el botón de encender
 * se deshabilita CON su explicación, en vez de dejar que alguien arme un flujo
 * completo para toparse con un 403 al final. Y el permiso de verdad no vive en
 * este booleano: vive en `servicio.activar()`, que exige rol admin del `ctx`
 * que armó `contextoDePeticion(req)`. Éste sólo evita el viaje en balde.
 */
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Operación</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Automatizaciones</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Descríbelo en español, míralo armado como pasos, edítalo a mano y velo correr paso por
          paso. Todo nace en pausa: encenderlo es una decisión tuya, aparte.
        </p>
      </header>

      <Pantalla puedeActivar={false} />
    </main>
  );
}
