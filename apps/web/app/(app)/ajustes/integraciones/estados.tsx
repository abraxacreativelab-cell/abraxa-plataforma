/**
 * Los estados honestos de esta pantalla, y la insignia que dice la verdad
 * sobre una credencial.
 *
 * Existe un componente propio para 'sin-cablear' porque NO es un error y no
 * puede verse como uno: un rojo de "algo falló" cuando lo que pasa es que
 * falta un merge manda a alguien a depurar un sistema que está bien.
 *
 * Y existe `Insignia` porque la distinción entre CAPTURADO y CONECTADO es el
 * carril entero. Una palomita verde sobre una credencial que nadie comprobó es
 * la mentira que produce "conecté mi WhatsApp y nadie contestó".
 */
import { Icon } from '@abraxa/ui';
import type { IntegrationStatus } from './tipos';

export function SinCablear({ motivo }: { motivo: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/30 p-8">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border">
          <Icon name="workflow" className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Falta cablear, no está roto
          </p>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground/80">{motivo}</p>
          <p className="mt-3 max-w-xl text-xs text-muted-foreground/60">
            Las integraciones sí existen:{' '}
            <code className="text-muted-foreground">packages/integrations</code> está construido,
            probado y registrado como port. Lo que falta es la línea que lo monta — vive en un
            archivo de H1 y por el contrato de no colisión no se toca desde este carril.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Los cuatro estados, con el nombre que significa algo para el emprendedor.
 *
 * `pending` no dice "pendiente": dice **capturado, sin comprobar**. Es la
 * diferencia entera y tiene que leerse sin traducir.
 *
 * Los iconos salen del registro de H5 (`packages/ui/.../icon.tsx`), que sólo
 * expone los que usa el producto; los nombres de aquí están en esa lista.
 */
const ESTADOS: Record<IntegrationStatus, { texto: string; clase: string; icono: string }> = {
  connected: {
    texto: 'Conectado y comprobado',
    clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    icono: 'check',
  },
  error: {
    texto: 'No está funcionando',
    clase: 'border-red-500/40 bg-red-500/10 text-red-300',
    icono: 'warning',
  },
  pending: {
    texto: 'Capturado, sin comprobar',
    clase: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    icono: 'refresh',
  },
  revoked: {
    texto: 'Desconectado',
    clase: 'border-border bg-card/40 text-muted-foreground',
    icono: 'lock',
  },
};

export function Insignia({ estado }: { estado: IntegrationStatus }) {
  const e = ESTADOS[estado] ?? ESTADOS.pending;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${e.clase}`}
    >
      <Icon name={e.icono} className="h-3 w-3" />
      {e.texto}
    </span>
  );
}

/**
 * El aviso que dejan las acciones al volver.
 *
 * Es un conjunto CERRADO de mensajes más, cuando lo hay, el motivo que devolvió
 * la API — que ya viene saneado: el paquete nunca deja pasar el cuerpo crudo
 * del proveedor, justamente porque Meta y Twilio devuelven el token dentro del
 * eco de error.
 */
export function Aviso({ tipo, detalle }: { tipo: string; detalle?: string }) {
  const copias: Record<string, { titulo: string; clase: string }> = {
    ok: {
      titulo: 'Listo: el proveedor aceptó la credencial.',
      clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    },
    'guardado-sin-verificar': {
      titulo: 'Se guardó, pero el proveedor todavía no la acepta.',
      clase: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    },
    revocada: {
      titulo: 'Desconectada. Deja de recibir y de mandar por ese canal.',
      clase: 'border-border bg-card/40 text-muted-foreground',
    },
    'sin-sesion': {
      titulo: 'No hay sesión verificada todavía: no se manda ninguna credencial sin saber quién eres.',
      clase: 'border-border bg-card/40 text-muted-foreground',
    },
    error: {
      titulo: 'No se pudo.',
      clase: 'border-red-500/40 bg-red-500/10 text-red-200',
    },
  };

  const copia = copias[tipo];
  if (!copia) return null;

  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${copia.clase}`}>
      <p className="font-medium">{copia.titulo}</p>
      {detalle && <p className="mt-1 text-xs opacity-90">{detalle}</p>}
    </div>
  );
}

/**
 * El aviso de respaldo de plataforma. Es el criterio 14 de §11 y no es
 * decorativo: un respaldo silencioso es exactamente cómo se llega a producción
 * con dos clientes compartiendo la misma cuenta sin que nadie lo haya decidido.
 */
export function RespaldoDePlataforma({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <p className="font-medium">Estás usando el {label} de la plataforma.</p>
      <p className="mt-1 text-xs opacity-90">
        Funciona, y es temporal a propósito: la reputación de ese dominio la comparten todos los
        negocios de la plataforma. Conecta el tuyo en cuanto lo tengas verificado.
      </p>
    </div>
  );
}
