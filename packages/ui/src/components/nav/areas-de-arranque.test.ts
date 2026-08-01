/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El encargo #2: «las secciones bloqueadas son el gancho, no una disculpa»
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Lo que estas pruebas defienden, en orden de importancia:
 *
 *   1. NINGUNA ruta de la navegación puede apuntar a una carpeta que no existe.
 *      Es el defecto exacto que traía `MOCK_AREAS`: cuatro de sus ocho enlaces
 *      —`/ventas`, `/ventas/contactos`, `/ventas/pipeline`, `/servicio`— no
 *      correspondían a ninguna carpeta de `apps/web/app`, y en producción no se
 *      avisaba, porque el aviso «navegación de prueba» sólo se pinta cuando
 *      `NODE_ENV !== 'production'`.
 *
 *   2. Toda área cerrada tiene promesa Y tiene requisito. Un candado sin
 *      letrero no invita a nada.
 *
 *   3. El requisito NO MIENTE: si el área no está construida, el candado no
 *      puede decir «sigue con tu Ritual», porque terminar el Ritual no la
 *      abriría.
 *
 *   4. Ninguna área cerrada es navegable, ni por `state` ni por `access`.
 */

import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetRegistry, lookupTool } from '../registry/tool-registry';
import { isNavigable } from './resolve-areas';
import {
  AREAS_DE_ARRANQUE,
  POR_QUE_NO_ABRE,
  type SenalesDelRitual,
  areasDeArranque,
  motivoDeCierre,
  registrarHerramientasDeArranque,
  requisitosDeArranque,
} from './areas-de-arranque';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = join(AQUI, '../../../../../apps/web/app');

/** Las 7 fases, con su número de fases cerradas. */
const senales = (faseIndice: number, over: Partial<SenalesDelRitual> = {}): SenalesDelRitual => ({
  faseIndice,
  fasesTotales: 7,
  completado: false,
  agente: 'Chica Guapa',
  ...over,
});

beforeEach(__resetRegistry);

// ════════════════════════════════════════════════════════════════════════════

describe('ni un enlace muerto en la navegación', () => {
  /**
   * Resuelve una ruta del producto a la carpeta de `apps/web/app` que la
   * pintaría, probando los tres grupos de ruta que existen. Devuelve `null` si
   * no hay `page.tsx` en ninguno.
   */
  const carpetaDe = (href: string): string | null => {
    const segmentos = href.replace(/^\//, '');
    for (const grupo of ['(app)', '(onboarding)', '(public)', '(admin)', '']) {
      const ruta = join(APP, grupo, segmentos, 'page.tsx');
      if (existsSync(ruta)) return ruta;
    }
    return null;
  };

  it('la carpeta de rutas de apps/web existe (si no, la prueba no prueba nada)', () => {
    expect(existsSync(APP)).toBe(true);
    expect(readdirSync(APP).length).toBeGreaterThan(0);
  });

  it('cada herramienta registrada apunta a una page.tsx que existe', () => {
    registrarHerramientasDeArranque();

    const rotas: string[] = [];
    for (const area of AREAS_DE_ARRANQUE) {
      for (const clave of area.tools) {
        const tool = lookupTool(clave);
        if (!tool) {
          rotas.push(`${clave} → sin registrar`);
          continue;
        }
        if (!carpetaDe(tool.href)) rotas.push(`${clave} → ${tool.href} (no existe)`);
      }
    }
    expect(rotas).toEqual([]);
  });

  it('el panel y los ajustes, que son los enlaces fijos, también existen', () => {
    // No son áreas, pero son los dos enlaces que el shell pinta siempre. Si uno
    // apunta a la nada, el invitado se topa con un 404 en la barra lateral.
    expect(carpetaDe('/ajustes')).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('el catálogo no inventa áreas', () => {
  it('son las cuatro del giro `general` de app.industry_templates', () => {
    // Consultado en producción el 2026-08-01. Si alguien añade un área que no
    // esté en la semilla, esta prueba lo obliga a justificarlo aquí.
    expect(AREAS_DE_ARRANQUE.map((a) => a.slug).sort()).toEqual([
      'direccion',
      'finanzas',
      'operaciones',
      'ventas',
    ]);
  });

  it('todas traen promesa, y no una etiqueta de relleno', () => {
    for (const a of AREAS_DE_ARRANQUE) {
      expect(a.blurb.trim().length, `${a.slug} sin promesa`).toBeGreaterThan(20);
      expect(a.label.trim()).not.toBe('');
    }
  });

  it('la escalera de fases es estrictamente creciente y arranca en la primera', () => {
    // La primera área tiene que abrir con UNA sola fase cerrada: es el encargo
    // de Santiago —«entregarle algo impresionante ya en la plataforma»— y sin
    // esto el invitado contesta siete veces antes de tocar producto.
    const orden = [...AREAS_DE_ARRANQUE].sort((a, b) => a.position - b.position);
    expect(orden[0]?.fasesQueNecesita).toBe(1);

    for (let i = 1; i < orden.length; i++) {
      expect(
        orden[i]!.fasesQueNecesita,
        `${orden[i]!.slug} no pide más que ${orden[i - 1]!.slug}`,
      ).toBeGreaterThan(orden[i - 1]!.fasesQueNecesita);
    }
  });

  it('ninguna pide más fases de las que tiene el Ritual', () => {
    for (const a of AREAS_DE_ARRANQUE) {
      expect(a.fasesQueNecesita).toBeGreaterThanOrEqual(1);
      expect(a.fasesQueNecesita).toBeLessThanOrEqual(7);
    }
  });

  it('toda área sin construir dice DÓNDE está el pendiente', () => {
    for (const a of AREAS_DE_ARRANQUE) {
      if (a.construida) continue;
      expect(POR_QUE_NO_ABRE[a.slug], `${a.slug} sin nota de por qué no abre`).toBeTruthy();
      expect(POR_QUE_NO_ABRE[a.slug]!.length).toBeGreaterThan(40);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('el motivo del cierre nunca miente', () => {
  it('una construida se abre al cerrar su fase', () => {
    const ventas = AREAS_DE_ARRANQUE.find((a) => a.slug === 'ventas')!;
    expect(ventas.construida).toBe(true);
    expect(motivoDeCierre(ventas, senales(0))).toBe('ritual');
    expect(motivoDeCierre(ventas, senales(1))).toBeNull();
  });

  it('una NO construida sigue cerrada aunque el Ritual esté completo', () => {
    // Es la prueba que impide la mentira: si dijera 'ritual', el invitado
    // terminaría las siete conversaciones y el área seguiría con candado.
    const direccion = AREAS_DE_ARRANQUE.find((a) => a.slug === 'direccion')!;
    expect(direccion.construida).toBe(false);
    expect(motivoDeCierre(direccion, senales(7, { completado: true }))).toBe('construccion');
  });

  it('sin señales del Ritual no se abre nada', () => {
    // Fail-closed. Si la foto del Ritual no llegó, lo peor que puede pasar es
    // que el invitado vea una puerta cerrada que ya tenía abierta; lo que NO
    // puede pasar es que vea abierta una que no lo está.
    for (const a of AREAS_DE_ARRANQUE) {
      expect(motivoDeCierre(a, null)).not.toBeNull();
    }
  });

  it('el Ritual completo abre todo lo construido', () => {
    const abiertas = AREAS_DE_ARRANQUE.filter(
      (a) => motivoDeCierre(a, senales(7, { completado: true })) === null,
    );
    expect(abiertas.map((a) => a.slug)).toEqual(
      AREAS_DE_ARRANQUE.filter((a) => a.construida).map((a) => a.slug),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('areasDeArranque — lo que consume el sidebar', () => {
  it('una cerrada no es navegable NI por state NI por access', () => {
    for (const a of areasDeArranque(null)) {
      if (a.state !== 'bloqueada') continue;
      expect(a.access, `${a.slug} bloqueada con acceso`).toBeNull();
      expect(isNavigable(a)).toBe(false);
    }
  });

  it('una cerrada no anuncia herramientas — no hay a dónde ir', () => {
    for (const a of areasDeArranque(null)) {
      if (a.state === 'bloqueada') expect(a.tools).toEqual([]);
    }
  });

  it('con una fase cerrada, Ventas abre y las otras tres siguen con candado', () => {
    // Es exactamente el estado del invitado que contestó cuatro preguntas.
    const areas = areasDeArranque(senales(1));
    const abiertas = areas.filter(isNavigable).map((a) => a.slug);
    expect(abiertas).toEqual(['ventas']);
    expect(areas.filter((a) => a.state === 'bloqueada')).toHaveLength(3);
  });

  it('las bloqueadas se MUESTRAN: siguen en la lista, no se filtran', () => {
    expect(areasDeArranque(null)).toHaveLength(AREAS_DE_ARRANQUE.length);
  });

  it('todas traen su promesa aunque estén bloqueadas', () => {
    for (const a of areasDeArranque(null)) expect(a.blurb.trim()).not.toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('requisitosDeArranque — el letrero del candado', () => {
  it('toda área cerrada tiene su frase', () => {
    const areas = areasDeArranque(senales(1));
    const req = requisitosDeArranque(senales(1));
    for (const a of areas) {
      if (a.state === 'bloqueada') {
        expect(req[a.slug], `${a.slug} con candado y sin letrero`).toBeTruthy();
      }
    }
  });

  it('ninguna abierta lleva letrero', () => {
    const req = requisitosDeArranque(senales(1));
    expect(req.ventas).toBeUndefined();
  });

  it('la frase del Ritual nombra al agente del emprendedor', () => {
    const req = requisitosDeArranque(senales(0));
    expect(req.ventas).toContain('Chica Guapa');
    expect(req.ventas).toContain('El bautizo');
  });

  it('sin nombre de agente no queda un hueco ni un "null"', () => {
    const req = requisitosDeArranque(senales(0, { agente: null }));
    expect(req.ventas).toContain('tu agente');
    expect(req.ventas).not.toContain('null');
    expect(req.ventas).not.toContain('undefined');
  });

  it('la frase de lo que no está construido NO promete que el Ritual lo abre', () => {
    const req = requisitosDeArranque(senales(7, { completado: true }));
    expect(req.direccion).toBeTruthy();
    expect(req.direccion!.toLowerCase()).not.toContain('ritual');
  });

  it('cada frase se lee como una frase, no como una clave', () => {
    const req = requisitosDeArranque(senales(0));
    for (const [slug, frase] of Object.entries(req)) {
      expect(frase.length, `${slug}: frase demasiado corta`).toBeGreaterThan(25);
      expect(frase, `${slug}: termina en punto y el shell le añade otro`).not.toMatch(/\.$/);
      expect(frase).not.toMatch(/[_{}]|undefined|null/);
    }
  });
});
