/**
 * El contrato del error de voz.
 *
 * La prueba que más importa de este archivo no se ejecuta: es la de tipos. Si
 * alguien renombra un código en `packages/db/ports.ts`, `CODIGOS_DEL_REPO` deja
 * de compilar y CI se pone rojo — en vez de que la bandeja reciba un código que
 * no conoce el día del evento.
 */
import { describe, expect, it } from 'vitest';
import type { PlatformErrorCode } from '@abraxa/db';
import { FalloDeVoz, falloDesdeCuerpo, type CodigoDeVoz } from './errores';

// ── La comprobación de tipos ────────────────────────────────────────────────
// Cada código de voz TIENE que ser uno del repo. No es una lista paralela: es
// un subconjunto, y esto lo ata en tiempo de compilación.
const CODIGOS_DEL_REPO: readonly PlatformErrorCode[] = [
  'UNAUTHENTICATED',
  'VALIDATION',
  'BUDGET_EXCEEDED',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'PORT_NOT_IMPLEMENTED',
] satisfies readonly CodigoDeVoz[];

describe('FalloDeVoz', () => {
  it('usa los mismos status que la tabla del repo', () => {
    const esperado: Record<CodigoDeVoz, number> = {
      UNAUTHENTICATED: 401,
      VALIDATION: 422,
      BUDGET_EXCEEDED: 402,
      RATE_LIMITED: 429,
      PROVIDER_ERROR: 502,
      PORT_NOT_IMPLEMENTED: 501,
    };
    for (const code of CODIGOS_DEL_REPO) {
      expect(new FalloDeVoz(code as CodigoDeVoz, 'x').status).toBe(esperado[code as CodigoDeVoz]);
    }
  });

  it('distingue lo que se reintenta de lo que no', () => {
    // Es LA decisión del cliente: reintentar, o apagar la voz para siempre.
    expect(new FalloDeVoz('RATE_LIMITED', 'x').reintentable).toBe(true);
    expect(new FalloDeVoz('PROVIDER_ERROR', 'x').reintentable).toBe(true);
    expect(new FalloDeVoz('BUDGET_EXCEEDED', 'x').reintentable).toBe(false);
    expect(new FalloDeVoz('PORT_NOT_IMPLEMENTED', 'x').reintentable).toBe(false);
    expect(new FalloDeVoz('VALIDATION', 'x').reintentable).toBe(false);
  });

  it('marca como definitivo lo que sólo se arregla tocando el servidor', () => {
    expect(new FalloDeVoz('PORT_NOT_IMPLEMENTED', 'x').definitivo).toBe(true);
    expect(new FalloDeVoz('BUDGET_EXCEEDED', 'x').definitivo).toBe(true);
    expect(new FalloDeVoz('RATE_LIMITED', 'x').definitivo).toBe(false);
  });

  it('el cuerpo tiene la forma del repo y no filtra el `cause`', () => {
    const fallo = new FalloDeVoz('BUDGET_EXCEEDED', 'sin crédito', {
      proveedor: 'openai',
      cause: new Error('sk-una-llave-que-jamás-debe-salir'),
    });
    const cuerpo = fallo.cuerpo();

    expect(cuerpo).toEqual({
      error: {
        code: 'BUDGET_EXCEEDED',
        message: 'sin crédito',
        voz: { reintentable: false, definitivo: true, proveedor: 'openai' },
      },
    });
    expect(JSON.stringify(cuerpo)).not.toContain('llave');
  });

  it('permite forzar el status sin inventar un código', () => {
    // Un timeout es PROVIDER_ERROR, pero 504 se lee mejor en un log de nginx.
    const fallo = new FalloDeVoz('PROVIDER_ERROR', 'tardó', { status: 504 });
    expect(fallo.code).toBe('PROVIDER_ERROR');
    expect(fallo.status).toBe(504);
  });
});

describe('falloDesdeCuerpo', () => {
  it('reconstruye un fallo tipado desde el JSON del endpoint', () => {
    const original = new FalloDeVoz('BUDGET_EXCEEDED', 'no hay crédito', { proveedor: 'groq' });
    const vuelto = falloDesdeCuerpo(original.cuerpo(), 402);

    expect(vuelto.code).toBe('BUDGET_EXCEEDED');
    expect(vuelto.message).toBe('no hay crédito');
    expect(vuelto.definitivo).toBe(true);
  });

  it('aguanta basura sin reventar — reventar aquí rompería la pantalla', () => {
    // Un 502 de nginx llega en HTML; un proxy raro puede mandar un cuerpo vacío.
    for (const basura of [null, undefined, '', 0, [], {}, { error: 'texto suelto' }, '<html>']) {
      const fallo = falloDesdeCuerpo(basura, 502);
      expect(fallo.code).toBe('PROVIDER_ERROR');
      expect(fallo.message.length).toBeGreaterThan(0);
    }
  });

  it('no acepta un código que no sea del vocabulario', () => {
    const fallo = falloDesdeCuerpo({ error: { code: 'ALGO_INVENTADO', message: 'x' } }, 500);
    expect(fallo.code).toBe('PROVIDER_ERROR');
    // El mensaje sí se conserva: es información real de quien contestó.
    expect(fallo.message).toBe('x');
  });
});
