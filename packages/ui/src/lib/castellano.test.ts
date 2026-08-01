import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  RESPALDO_SIN_JERGA,
  marcadoresDeJerga,
  sinJerga,
  tieneJerga,
} from './castellano';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La aduana, probada contra lo que un invitado LEYÓ EN VIVO
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Cada frase de `EN_VIVO` se transcribió del ensayo del 2026-08-01 o del
 *  archivo que la produce hoy. No son ejemplos inventados: son las cinco
 *  pantallas del hallazgo 5, con su ruta.
 *
 *  Y la mitad de abajo importa igual: las frases que NO se pueden tocar. Un
 *  filtro que además borra el nombre del agente del emprendedor es peor que no
 *  tener filtro.
 */

afterEach(() => vi.restoreAllMocks());

const EN_VIVO: readonly { donde: string; frase: string }[] = [
  {
    donde: 'apps/web/app/(app)/direccion/_components/estado-boveda.tsx — la Bóveda',
    frase: 'Falta: H2 · packages/tenancy',
  },
  {
    donde: 'apps/web/app/(app)/mapa/context.ts — el Mapa de Negocio',
    frase: 'El módulo de sesión y empresa (H2) todavía no está registrado.',
  },
  {
    donde: 'apps/web/app/(app)/mapa/context.ts — el Mapa, con el port ya registrado',
    frase: 'Falta cablear la sesión verificada con TenancyPort.contextFor().',
  },
  {
    donde: 'apps/web/app/(app)/contactos/estados.tsx — Contactos',
    frase:
      'El CRM sí existe: packages/crm está construido, probado y registrado como port. ' +
      'Lo que falta es la línea que lo monta — vive en un archivo de H1 y por el contrato ' +
      'de no colisión no se toca desde este carril.',
  },
  {
    donde: 'apps/web/app/(app)/ajustes/plan/estados.tsx — el plan',
    frase:
      'Los entitlements sí existen: packages/tenancy/src/entitlements está construido y ' +
      'probado, y sus migraciones 130–132 están escritas.',
  },
  {
    donde: 'apps/web/app/(app)/ajustes/plan/pausa-boton.tsx — pausar el plan',
    frase: 'Falta cablear la ruta (H18).',
  },
  {
    donde: 'packages/ui — la nota de por qué no abre un área',
    frase:
      'apps/web/app/(app)/direccion/_lib/session.ts:119 — correoDeLaSesion() devuelve null.',
  },
  {
    donde: 'packages/onboarding/src/routes.ts — el estado del carril',
    frase: 'pendiente (H11 · packages/areas)',
  },
  {
    donde: 'un error de plataforma sin traducir',
    frase: 'PORT_NOT_IMPLEMENTED: el módulo no respondió.',
  },
  {
    donde: 'una tabla de la base filtrada a la pantalla',
    frase: 'La tabla app.tenant_areas está vacía para esta empresa.',
  },
];

describe('la jerga que un invitado leyó en vivo', () => {
  it.each(EN_VIVO)('la detecta — $donde', ({ frase }) => {
    expect(tieneJerga(frase), frase).toBe(true);
  });

  it.each(EN_VIVO)('nunca la deja pasar a la pantalla — $donde', ({ frase }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const salida = sinJerga(frase);

    expect(salida).toBe(RESPALDO_SIN_JERGA);
    expect(tieneJerga(salida)).toBe(false);
  });

  it('el diagnóstico NO se pierde: va al log con la frase original', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sinJerga('Falta: H2 · packages/tenancy');

    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('Falta: H2 · packages/tenancy');
  });

  it('nombra qué marcador se disparó, para poder arreglar la frase', () => {
    expect(marcadoresDeJerga('Falta: H2 · packages/tenancy')).toEqual(
      expect.arrayContaining(['carril', 'ruta']),
    );
    expect(marcadoresDeJerga('sus migraciones 130–132 están escritas')).toContain('migración');
  });
});

/**
 * ── Lo que NO se puede tocar ────────────────────────────────────────────────
 *
 * El nombre del agente lo elige el emprendedor y entra INTERPOLADO en estas
 * frases. Un filtro que se dispare con un nombre propio le borraría su frase
 * por haberle puesto a su agente como se le dio la gana.
 */
const INTOCABLES: readonly string[] = [
  // Las que produce `requisitosDeArranque()`, con los nombres reales que hay
  // hoy en producción (`app.onboarding_sessions.state->agente`).
  'Chica Guapa termine contigo «El bautizo» en tu Ritual de Fundación',
  'Lupita termine contigo «Cómo ganas dinero» en tu Ritual de Fundación',
  'tu agente termine contigo «Tu proceso» en tu Ritual de Fundación',
  'terminemos de construirla — es cosa nuestra, no tuya, y aquí te avisamos',

  // Nombres de agente que un filtro perezoso rompería: mayúscula interior,
  // marca conocida, acrónimo. Ninguno es una llamada de código.
  'AbraXa ya conoce tu negocio de punta a punta.',
  'McDonalds te está esperando en tu Ritual.',
  'Tu CRM guarda a todos tus clientes en un solo lugar.',
  'iPhone es tu agente y ya sabe a qué te dedicas.',

  // Copy de producto que sí se le enseña al cliente.
  'Cómo llega un cliente y cómo se cierra la venta.',
  'Tu bóveda: los números, los documentos y la biblioteca del negocio.',
  'Siete conversaciones cortas con tu agente y tu negocio queda montado aquí dentro.',
  'Qué te roba tiempo y dinero. Aquí se pone incómodo.',
  'Aún no tienes contactos.',
  'Vendes 20 hamburguesas el viernes de quincena y no te alcanza la plancha.',
  'Se abre cuando tu agente termine contigo El bautizo.',
];

describe('lo que tiene que pasar intacto', () => {
  it.each(INTOCABLES)('no la toca: %s', (frase) => {
    expect(tieneJerga(frase), `marcadores: ${marcadoresDeJerga(frase).join(', ')}`).toBe(false);
    expect(sinJerga(frase)).toBe(frase);
  });
});

describe('los bordes', () => {
  it('null y undefined salen como entraron: una frase que no existe no se inventa', () => {
    expect(sinJerga(null)).toBeNull();
    expect(sinJerga(undefined)).toBeUndefined();
    expect(tieneJerga(null)).toBe(false);
  });

  it('una cadena vacía no se convierte en una disculpa', () => {
    expect(sinJerga('')).toBe('');
    expect(sinJerga('   ')).toBe('   ');
  });

  it('acepta un respaldo propio, para que cada pantalla diga lo suyo', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(sinJerga('Falta: H2 · packages/tenancy', 'Todavía no la abrimos.')).toBe(
      'Todavía no la abrimos.',
    );
  });

  it('el respaldo por defecto está en castellano y no trae jerga', () => {
    expect(tieneJerga(RESPALDO_SIN_JERGA)).toBe(false);
    expect(RESPALDO_SIN_JERGA.length).toBeGreaterThan(30);
  });
});
