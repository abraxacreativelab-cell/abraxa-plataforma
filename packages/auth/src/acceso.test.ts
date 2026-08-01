import { describe, expect, it } from 'vitest';
import { correosPermitidos, normalizarCorreo, puedeEntrar } from './acceso';

describe('normalizarCorreo', () => {
  it('normaliza igual que `app.users`', () => {
    expect(normalizarCorreo('  Ana@Gmail.COM ')).toBe('ana@gmail.com');
  });

  it('descarta la basura evidente', () => {
    for (const malo of [null, undefined, '', '   ', 'sin-arroba', '@']) {
      expect(normalizarCorreo(malo), String(malo)).toBe('');
    }
  });
});

describe('puedeEntrar', () => {
  /**
   * El caso del evento: nadie sabe de antemano con qué correo va a llegar
   * cada invitado, y una allowlist vacía tiene que significar "cualquiera".
   */
  it('sin allowlist, entra cualquier cuenta de Google', () => {
    expect(puedeEntrar('quien.sea@gmail.com', {})).toBe(true);
    expect(puedeEntrar('quien.sea@gmail.com', { AUTH_ALLOWED_EMAILS: '' })).toBe(true);
    expect(puedeEntrar('quien.sea@gmail.com', { AUTH_ALLOWED_EMAILS: '  ,  ' })).toBe(true);
  });

  it('con allowlist, sólo ella', () => {
    const env = { AUTH_ALLOWED_EMAILS: 'santiago@abraxa.club, Ana@Gmail.com' };
    expect(puedeEntrar('santiago@abraxa.club', env)).toBe(true);
    expect(puedeEntrar('ANA@gmail.com', env)).toBe(true);
    expect(puedeEntrar('otro@gmail.com', env)).toBe(false);
  });

  it('un correo inválido no entra nunca', () => {
    expect(puedeEntrar('', {})).toBe(false);
    expect(puedeEntrar(null, {})).toBe(false);
    expect(puedeEntrar('sin-arroba', {})).toBe(false);
    expect(puedeEntrar('sin-arroba', { AUTH_ALLOWED_EMAILS: 'sin-arroba' })).toBe(false);
  });
});

describe('correosPermitidos', () => {
  it('parte por comas, recorta y baja a minúsculas', () => {
    expect(correosPermitidos({ AUTH_ALLOWED_EMAILS: ' A@b.co , C@d.co ,, ' })).toEqual([
      'a@b.co',
      'c@d.co',
    ]);
  });

  it('sin la variable, lista vacía', () => {
    expect(correosPermitidos({})).toEqual([]);
  });
});
