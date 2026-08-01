/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Criterio #8 — firma inválida → rechazada. Y la trampa del cuerpo crudo.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La prueba que de verdad vale de este archivo es
 *  «el cuerpo re-serializado NO valida»: es la que demuestra, con bytes de
 *  verdad, por qué no puede haber un respaldo que llame a `JSON.stringify` — y
 *  por qué el síntoma de haberlo puesto se parece a un secreto mal configurado.
 */
import { describe, expect, it } from 'vitest';
import {
  CABECERA_FIRMA,
  cuerpoCrudoDelSobre,
  firmaDe,
  verificarChallenge,
  verificarFirma,
} from './firma';

const SECRETO = 'app-secret-de-prueba';

/** Un cuerpo como los que manda Meta: compacto y con acentos sin escapar. */
const CRUDO = '{"object":"instagram","entry":[{"id":"1784140","messaging":[{"m":"¿cuánto?"}]}]}';

describe('verificarFirma', () => {
  it('acepta la firma que corresponde al cuerpo', () => {
    expect(verificarFirma({ cuerpo: CRUDO, firma: firmaDe(CRUDO, SECRETO), appSecret: SECRETO })).toBe(
      true,
    );
  });

  it('rechaza una firma de otro secreto', () => {
    expect(
      verificarFirma({ cuerpo: CRUDO, firma: firmaDe(CRUDO, 'otro'), appSecret: SECRETO }),
    ).toBe(false);
  });

  it('rechaza si el cuerpo cambió aunque sea un byte', () => {
    const firma = firmaDe(CRUDO, SECRETO);
    expect(verificarFirma({ cuerpo: `${CRUDO} `, firma, appSecret: SECRETO })).toBe(false);
  });

  it('rechaza sha1: no se acepta el algoritmo débil pudiendo usar el fuerte', () => {
    const sha1 = 'sha1=0000000000000000000000000000000000000000';
    expect(verificarFirma({ cuerpo: CRUDO, firma: sha1, appSecret: SECRETO })).toBe(false);
  });

  it('rechaza sin firma, sin secreto, y con basura en la cabecera', () => {
    const firma = firmaDe(CRUDO, SECRETO);
    expect(verificarFirma({ cuerpo: CRUDO, firma: undefined, appSecret: SECRETO })).toBe(false);
    expect(verificarFirma({ cuerpo: CRUDO, firma, appSecret: '' })).toBe(false);
    expect(verificarFirma({ cuerpo: CRUDO, firma: 'sha256=nada', appSecret: SECRETO })).toBe(false);
    expect(verificarFirma({ cuerpo: CRUDO, firma: 'sha256=', appSecret: SECRETO })).toBe(false);
  });

  it('acepta Buffer y string por igual — es el mismo HMAC', () => {
    const firma = firmaDe(Buffer.from(CRUDO, 'utf8'), SECRETO);
    expect(verificarFirma({ cuerpo: CRUDO, firma, appSecret: SECRETO })).toBe(true);
  });

  /**
   * ── LA prueba de este archivo ──────────────────────────────────────────────
   *
   * Verificar contra el cuerpo ya parseado y vuelto a serializar calcula el
   * HMAC sobre BYTES DISTINTOS. Aquí se mide: `JSON.stringify(JSON.parse(x))`
   * no devuelve `x`, y por eso la firma legítima de Meta no valida.
   *
   * Si alguien "arregla" un día el rechazo por falta de cuerpo crudo metiendo
   * un `JSON.stringify(payload)`, todos los eventos legítimos empezarán a
   * rechazarse y el síntoma parecerá un App Secret equivocado. Esta prueba
   * existe para que ese arreglo se vea aquí antes que en producción.
   */
  it('el cuerpo RE-SERIALIZADO no valida — por eso no hay respaldo', () => {
    const conEspacios = JSON.stringify(JSON.parse(CRUDO), null, 2);
    const firmaLegitima = firmaDe(CRUDO, SECRETO);

    expect(conEspacios).not.toBe(CRUDO);
    expect(verificarFirma({ cuerpo: conEspacios, firma: firmaLegitima, appSecret: SECRETO })).toBe(
      false,
    );
  });
});

describe('cuerpoCrudoDelSobre', () => {
  it('lee el Buffer que `apps/api` deja en `req.rawBody`', () => {
    const b = Buffer.from(CRUDO, 'utf8');
    expect(cuerpoCrudoDelSobre({ channelId: 'c1', rawBody: b })?.toString()).toBe(CRUDO);
  });

  it('acepta string y Uint8Array', () => {
    expect(cuerpoCrudoDelSobre({ rawBody: CRUDO })?.toString()).toBe(CRUDO);
    expect(cuerpoCrudoDelSobre({ rawBody: new TextEncoder().encode(CRUDO) })?.toString()).toBe(CRUDO);
  });

  it('devuelve null cuando no viene — que es el estado de HOY', () => {
    // El sobre que arma la ruta de H6 lleva `channelId`, `payload` y `headers`.
    // El cuerpo crudo NO viaja todavía: es la línea que pide el README.
    expect(cuerpoCrudoDelSobre({ channelId: 'c1', payload: {}, headers: {} })).toBeNull();
    expect(cuerpoCrudoDelSobre({ rawBody: '' })).toBeNull();
    expect(cuerpoCrudoDelSobre(null)).toBeNull();
  });
});

describe('verificarChallenge', () => {
  const TOKEN = 'verify-token-del-canal';

  it('devuelve el challenge cuando todo coincide', () => {
    const query = {
      'hub.mode': 'subscribe',
      'hub.verify_token': TOKEN,
      'hub.challenge': '1158201444',
    };
    expect(verificarChallenge(query, TOKEN)).toBe('1158201444');
  });

  it('acepta también la forma anidada, por si un proxy expande los puntos', () => {
    const query = { hub: { mode: 'subscribe', verify_token: TOKEN, challenge: '99' } };
    expect(verificarChallenge(query, TOKEN)).toBe('99');
  });

  it('rechaza el token equivocado, el modo equivocado y el challenge vacío', () => {
    const ok = { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '1' };
    expect(verificarChallenge({ ...ok, 'hub.verify_token': 'otro' }, TOKEN)).toBeNull();
    expect(verificarChallenge({ ...ok, 'hub.mode': 'unsubscribe' }, TOKEN)).toBeNull();
    expect(verificarChallenge({ ...ok, 'hub.challenge': '' }, TOKEN)).toBeNull();
    expect(verificarChallenge({}, TOKEN)).toBeNull();
  });

  it('sin `verify_token` configurado no valida nada — fail-closed', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' };
    expect(verificarChallenge(query, '')).toBeNull();
  });

  it('el challenge se devuelve TAL CUAL, sin envolver', () => {
    // Meta compara el cuerpo de la respuesta con el challenge exacto. Cualquier
    // envoltura —`{"ok":true}`, comillas, un salto de línea— falla la
    // verificación. Por eso lo que sale de aquí es la cadena pelada.
    const r = verificarChallenge(
      { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '1158201444' },
      TOKEN,
    );
    expect(r).toBe('1158201444');
    expect(JSON.stringify(r)).not.toBe(r);
  });
});

describe('la cabecera', () => {
  it('es la de sha256 y en minúsculas, como las guarda Node', () => {
    expect(CABECERA_FIRMA).toBe('x-hub-signature-256');
  });
});
