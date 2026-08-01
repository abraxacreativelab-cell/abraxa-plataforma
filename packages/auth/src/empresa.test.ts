import { describe, expect, it } from 'vitest';
import { ApiFalsa } from './api-falsa';
import { empresaDe, type Transporte } from './empresa';
import { slugDeCorreo } from './slug';

describe('empresaDe', () => {
  it('da de alta la empresa la primera vez', async () => {
    const api = new ApiFalsa();
    const r = await empresaDe('ana@gmail.com', 'Ana Ruiz', api.transporte);

    expect(r).toEqual({
      estado: 'lista',
      slug: slugDeCorreo('ana@gmail.com'),
      nombre: 'Ana Ruiz',
      creada: true,
    });
    expect(api.tenants[0]?.owner).toBe('ana@gmail.com');
  });

  it('el dueño sale de la sesión, no del cuerpo', async () => {
    const api = new ApiFalsa();
    await empresaDe('ana@gmail.com', 'Ana Ruiz', api.transporte);

    const alta = api.llamadas.find((l) => l.ruta === '/tenants');
    expect(alta?.correo).toBe('ana@gmail.com');
    expect(Object.keys(alta?.cuerpo as object)).toEqual(['slug', 'name']);
  });

  it('reusa la que ya tiene sin volver a dar de alta', async () => {
    const api = new ApiFalsa();
    api.tenants.push({ slug: 'ya-existente', name: 'Ya existente', owner: 'ana@gmail.com' });
    api.membresias.push({
      slug: 'ya-existente',
      email: 'ana@gmail.com',
      role: 'owner',
      status: 'active',
    });

    const r = await empresaDe('ana@gmail.com', 'Ana Ruiz', api.transporte);

    expect(r).toEqual({
      estado: 'lista',
      slug: 'ya-existente',
      nombre: 'Ya existente',
      creada: false,
    });
    expect(api.llamadas.some((l) => l.ruta === '/tenants' && l.metodo === 'POST')).toBe(false);
  });

  /**
   * Con varias empresas, la SUYA. Elegir "la primera que devolvió la API"
   * haría que la misma persona aterrizara un día en una y al siguiente en
   * otra, según cómo ordenara Postgres esa consulta.
   */
  it('con varias, prefiere de la que es dueña', async () => {
    const api = new ApiFalsa();
    for (const [slug, rol] of [
      ['zeta-invitada', 'viewer'],
      ['alfa-invitada', 'member'],
      ['mia', 'owner'],
    ] as const) {
      api.tenants.push({ slug, name: slug, owner: 'quien-sea@x.com' });
      api.membresias.push({ slug, email: 'ana@gmail.com', role: rol, status: 'active' });
    }

    const r = await empresaDe('ana@gmail.com', 'Ana', api.transporte);
    expect(r.estado === 'lista' && r.slug).toBe('mia');
  });

  it('a igualdad de rol, el orden es estable', async () => {
    const api = new ApiFalsa();
    for (const slug of ['zeta', 'alfa', 'media']) {
      api.tenants.push({ slug, name: slug, owner: 'x@x.com' });
      api.membresias.push({ slug, email: 'ana@gmail.com', role: 'member', status: 'active' });
    }
    const r = await empresaDe('ana@gmail.com', 'Ana', api.transporte);
    expect(r.estado === 'lista' && r.slug).toBe('alfa');
  });

  it('ignora las empresas que no están activas', async () => {
    const api = new ApiFalsa();
    api.tenants.push({ slug: 'suspendida', name: 'Suspendida', owner: 'ana@gmail.com' });
    api.membresias.push({
      slug: 'suspendida',
      email: 'ana@gmail.com',
      role: 'owner',
      status: 'suspended',
    });

    const r = await empresaDe('ana@gmail.com', 'Ana', api.transporte);
    expect(r.estado === 'lista' && r.slug).toBe(slugDeCorreo('ana@gmail.com'));
  });

  it('reintenta con otro slug ante CONFLICT y se rinde después de tres', async () => {
    let intentos = 0;
    const siempreOcupado: Transporte = async (p) => {
      if (p.ruta === '/tenants/mine') return { status: 200, cuerpo: { tenants: [] } };
      intentos++;
      return { status: 409, cuerpo: { error: { code: 'CONFLICT', message: 'ya está tomado' } } };
    };

    const r = await empresaDe('ana@gmail.com', 'Ana', siempreOcupado);

    expect(intentos).toBe(3);
    expect(r.estado).toBe('sin-empresa');
    expect(r.estado === 'sin-empresa' && r.motivo).toContain('3 slugs distintos');
  });

  it('NO reintenta ante un error que reintentar no arregla', async () => {
    let intentos = 0;
    const sinSecreto: Transporte = async (p) => {
      if (p.ruta === '/tenants/mine') return { status: 200, cuerpo: { tenants: [] } };
      intentos++;
      return {
        status: 401,
        cuerpo: { error: { code: 'UNAUTHENTICATED', message: 'Sólo por el proxy verificado.' } },
      };
    };

    const r = await empresaDe('ana@gmail.com', 'Ana', sinSecreto);

    expect(intentos).toBe(1);
    expect(r.estado === 'sin-empresa' && r.motivo).toContain('Sólo por el proxy verificado');
    expect(r.estado === 'sin-empresa' && r.motivo).toContain('401');
  });

  it('si la red se cae, lo dice y no lanza', async () => {
    const caida: Transporte = async () => {
      throw new Error('ECONNREFUSED');
    };

    const r = await empresaDe('ana@gmail.com', 'Ana', caida);
    expect(r.estado).toBe('sin-empresa');
    expect(r.estado === 'sin-empresa' && r.motivo).toContain('ECONNREFUSED');
  });

  it('sin correo, no llama a nadie', async () => {
    let llamadas = 0;
    const contador: Transporte = async () => {
      llamadas++;
      return { status: 200, cuerpo: {} };
    };

    const r = await empresaDe('   ', 'Ana', contador);
    expect(r.estado).toBe('sin-empresa');
    expect(llamadas).toBe(0);
  });

  it('una respuesta con basura dentro no lo tumba', async () => {
    const basura: Transporte = async (p) =>
      p.ruta === '/tenants/mine'
        ? { status: 200, cuerpo: { tenants: [null, 42, { slug: 3 }, { slug: 'ok' }] } }
        : { status: 201, cuerpo: { created: true } };

    const r = await empresaDe('ana@gmail.com', 'Ana', basura);
    // Ninguna de las cuatro es una empresa activa válida: se da de alta.
    expect(r.estado === 'lista' && r.slug).toBe(slugDeCorreo('ana@gmail.com'));
  });
});
