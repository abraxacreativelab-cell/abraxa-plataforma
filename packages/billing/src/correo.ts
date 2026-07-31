/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El correo de bienvenida.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es el único hilo entre "pagué en Stripe" y "estoy dentro del producto". Si
 *  no llega, el emprendedor pagó y no tiene a dónde ir.
 *
 *  ── Por qué esto NO puede tumbar el webhook ────────────────────────────────
 *
 *  La regla 3 del handoff pide responder 200 rápido; la 4 prohíbe responder
 *  200 si el alta falló. Se cumplen las dos separando lo que es parte del alta
 *  de lo que no:
 *
 *    · Crear el tenant SÍ condiciona el 200. Sin empresa no hay nada.
 *    · Mandar el correo NO. La cuenta ya existe; el correo se puede reenviar
 *      desde el panel. Tumbar la respuesta por un 500 de Resend haría que
 *      Stripe reintentara un alta que ya funcionó.
 *
 *  Por eso esto devuelve un resultado en vez de lanzar, y el que llama lo
 *  registra.
 */
import { env } from '@abraxa/config';

export interface CorreoDeBienvenida {
  para: string;
  businessName: string;
  slug: string;
  /** A dónde entra. Lo construye `enlaceDeEntrada()`. */
  enlace: string;
}

export interface ResultadoDeEnvio {
  enviado: boolean;
  /** `resend` = salió de verdad · `doble` = sólo se registró en consola. */
  via: 'resend' | 'doble';
  motivo?: string;
}

/**
 * A dónde manda el correo.
 *
 * Apunta a la página pública de bienvenida —que es de este carril— y no
 * directo al Ritual de H7 ni al login de H18. La razón es que ninguno de los
 * dos existe todavía, y un correo con un enlace roto es peor que uno con un
 * enlace que explica qué sigue. Cuando H18 aterrice, esa página lo manda a
 * iniciar sesión y de ahí al Ritual, sin que este archivo cambie.
 */
export function enlaceDeEntrada(slug: string): string {
  const base = env().APP_BASE_URL.replace(/\/+$/, '');
  return `${base}/bienvenida?empresa=${encodeURIComponent(slug)}`;
}

const ASUNTO = 'Tu negocio ya tiene su espacio en ABRAXA';

function cuerpoTexto(c: CorreoDeBienvenida): string {
  return [
    `Listo, ${c.businessName} ya está dentro.`,
    '',
    'Entra aquí y tu agente maestro te va a hacer unas preguntas para',
    'entender cómo trabajas. Toma unos minutos y es lo único que necesitas',
    'hacer para arrancar:',
    '',
    c.enlace,
    '',
    'Si algo no funciona, responde este correo y lo vemos.',
    '',
    '— ABRAXA',
  ].join('\n');
}

function cuerpoHtml(c: CorreoDeBienvenida): string {
  // HTML deliberadamente pobre: los clientes de correo no son navegadores y
  // aquí lo único que importa es que el botón se vea y se pueda picar.
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;line-height:1.6">',
    `<p>Listo, <strong>${escaparHtml(c.businessName)}</strong> ya está dentro.</p>`,
    '<p>Entra y tu agente maestro te va a hacer unas preguntas para entender cómo',
    'trabajas. Toma unos minutos y es lo único que necesitas hacer para arrancar.</p>',
    `<p><a href="${escaparHtml(c.enlace)}"`,
    ' style="display:inline-block;padding:12px 20px;border-radius:8px;',
    'background:#0f172a;color:#fff;text-decoration:none">Entrar a mi espacio</a></p>',
    `<p style="color:#64748b;font-size:13px">O copia este enlace: ${escaparHtml(c.enlace)}</p>`,
    '<p style="color:#64748b;font-size:13px">Si algo no funciona, responde este correo.</p>',
    '</div>',
  ].join('');
}

function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** El remitente. Va aquí y no en el entorno porque el dominio es del producto. */
const DE = 'ABRAXA <hola@abraxa.club>';

/**
 * Manda el correo. Nunca lanza.
 *
 * Sin `RESEND_API_KEY` escribe el correo completo en consola —incluido el
 * enlace— para que el alta se pueda seguir de punta a punta sin cuenta de
 * Resend. Es el mismo criterio del gateway de Stripe: sin llaves se sigue
 * pudiendo probar el flujo, y se dice con todas sus letras que no salió nada.
 */
export async function enviarBienvenida(c: CorreoDeBienvenida): Promise<ResultadoDeEnvio> {
  const apiKey = env().RESEND_API_KEY;

  if (!apiKey) {
    console.warn(
      `[billing] sin RESEND_API_KEY — correo NO enviado a ${c.para}.\n` +
        `          asunto: ${ASUNTO}\n` +
        `          enlace: ${c.enlace}`,
    );
    return { enviado: false, via: 'doble', motivo: 'sin RESEND_API_KEY' };
  }

  try {
    // Import dinámico: `resend` sólo se carga si de verdad se va a usar, así
    // el arranque en modo doble no paga por una dependencia que no toca.
    const { Resend } = await import('resend');
    const { error } = await new Resend(apiKey).emails.send({
      from: DE,
      to: c.para,
      subject: ASUNTO,
      text: cuerpoTexto(c),
      html: cuerpoHtml(c),
    });

    if (error) {
      console.error(`[billing] Resend rechazó el correo a ${c.para}:`, error.message);
      return { enviado: false, via: 'resend', motivo: error.message };
    }
    return { enviado: true, via: 'resend' };
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    console.error(`[billing] falló el envío del correo a ${c.para}:`, motivo);
    return { enviado: false, via: 'resend', motivo };
  }
}
