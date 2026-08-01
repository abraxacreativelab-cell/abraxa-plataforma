/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El Mapa de Negocio — la síntesis, sin modelo de por medio.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Una función pura: entra lo que se supo del negocio, sale el mapa completo.
 *
 *  Que no dependa del modelo es deliberado. El mapa es el pago emocional de 20
 *  minutos de preguntas (handoff §8) y no puede salir distinto según qué tan
 *  cooperativo amaneció un proveedor. El modelo ya hizo su trabajo —entrevistar
 *  bien y proponer áreas e hitos durante la conversación—; convertir eso en un
 *  mapa es aritmética, y la aritmética se prueba.
 *
 *  Consecuencia práctica: el criterio #4 ("dos giros distintos, mapas
 *  distintos") se verifica en CI con dos objetos y cero tokens.
 */
import type { AreaDelMapa, EstadoNegocio, Hito, MapaDeNegocio } from '../types';
import { CATALOGO } from './catalogo';
import { tipoDeIndustria, type PlantillaDeGiro } from './industria';

// ════════════════════════════════════════════════════════════════════════════
// Las áreas
// ════════════════════════════════════════════════════════════════════════════

/**
 * Con qué estado nace cada área para ESTE negocio.
 *
 * Dos capas, en este orden:
 *   1. la regla determinista del catálogo, que lee los datos del negocio;
 *   2. lo que el agente propuso explícitamente durante la entrevista, que le
 *      gana a la regla — él habló con la persona.
 *
 * Las bloqueadas se devuelven igual, con su promesa y su razón. H11 §5 lo pide
 * explícito y tiene razón: ver "Equipo · graduarte de solopreneur" con candado
 * le planta una idea que va a querer. Esconderlas es tirar el motor del
 * producto a la basura.
 */
export function areasPara(e: EstadoNegocio): AreaDelMapa[] {
  const propuestas = new Map((e.areasPropuestas ?? []).map((p) => [p.slug, p]));

  return CATALOGO.map((area): AreaDelMapa => {
    const base = area.decidir(e);
    const propuesta = propuestas.get(area.slug);

    return {
      slug: area.slug,
      label: area.label,
      blurb: area.blurb,
      position: area.position,
      estado: propuesta?.estado ?? base.estado,
      razon: propuesta?.razon ?? base.razon,
      requisitos: area.requisitos,
    };
  }).sort((a, b) => a.position - b.position);
}

// ════════════════════════════════════════════════════════════════════════════
// El roadmap
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los hitos, en el orden en que conviene hacerlos.
 *
 * El criterio de orden no es la severidad: es qué tan pronto el emprendedor va
 * a ver que algo cambió.
 *
 *   1. Lo que salió del abogado del diablo, primero. Es lo que él no había
 *      pedido y por lo que sintió que alguien entendió su negocio; enterrarlo
 *      en la posición 9 desperdicia la única fase que da "wow".
 *   2. Lo que él sí pidió.
 *   3. Lo que hace falta para abrir cada área bloqueada, en orden de área.
 *
 * Lo último se agrega SIEMPRE, aunque el agente no haya dicho nada: un área con
 * candado y sin instrucciones de cómo abrirla es una promesa incumplida.
 */
export function hitosPara(e: EstadoNegocio, areas: AreaDelMapa[]): Hito[] {
  const propios = e.hitos ?? [];
  const delDiablo = propios.filter((h) => h.origen === 'abogado_del_diablo');
  const delEmprendedor = propios.filter((h) => h.origen !== 'abogado_del_diablo');

  const vistos = new Set(propios.map((h) => h.titulo.trim().toLowerCase()));
  const deDesbloqueo: Hito[] = [];

  for (const area of areas) {
    if (area.estado !== 'bloqueada') continue;
    for (const r of area.requisitos) {
      const titulo = `Para abrir ${area.label}: ${r.label}`;
      const clave = titulo.trim().toLowerCase();
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      deDesbloqueo.push({
        areaSlug: area.slug,
        titulo,
        detalle: area.blurb,
        origen: 'catalogo',
      });
    }
  }

  return [...delDiablo, ...delEmprendedor, ...deDesbloqueo];
}

// ════════════════════════════════════════════════════════════════════════════
// El documento madre
// ════════════════════════════════════════════════════════════════════════════

function seccion(titulo: string, cuerpo: string | null): string {
  return cuerpo ? `## ${titulo}\n\n${cuerpo}\n` : '';
}

function lista(items: string[]): string | null {
  return items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : null;
}

/**
 * El resumen del negocio en prosa: lo que se manda a la bóveda por
 * `VaultPort.ingestDocument()` y lo que el agente relee para siempre.
 *
 * Es el equivalente del `document-builder.ts` de GARDEN, con dos diferencias
 * de fondo: se arma con código y no pidiéndole al modelo que redacte (no puede
 * inventar un dato que nadie dijo), y habla del NEGOCIO, no de un área de una
 * inmobiliaria.
 */
export function resumenDelNegocio(e: EstadoNegocio, areas: AreaDelMapa[], hitos: Hito[]): string {
  const identidad = [
    e.categoria ? `**Categoría:** ${e.categoria}` : null,
    e.giro ? `**Giro:** ${e.giro}` : null,
    e.nicho ? `**A quién le vende:** ${e.nicho}` : null,
    e.etapa ? `**Etapa:** ${e.etapa}` : null,
    e.tamano ? `**Tamaño hoy:** ${e.tamano}` : null,
  ].filter((x): x is string => x !== null);

  const modelo = [
    e.modeloIngreso ? `**Cómo gana dinero:** ${e.modeloIngreso}` : null,
    e.ticket ? `**Ticket promedio:** ${e.ticket}` : null,
    e.margen ? `**Margen:** ${e.margen}` : null,
    (e.canales?.length ?? 0) > 0 ? `**Canales:** ${(e.canales ?? []).join(', ')}` : null,
  ].filter((x): x is string => x !== null);

  const recorrido = (e.recorrido ?? []).map(
    (p, i) => `${i + 1}. **${p.nombre}**${p.como ? ` — ${p.como}` : ''}`,
  );

  const dolores = (e.dolores ?? []).map((d) => d.texto);

  const gente = [
    e.equipo ? `**Cuántos son:** ${e.equipo}` : null,
    e.equipoDetalle ? e.equipoDetalle : null,
  ].filter((x): x is string => x !== null);

  const mapaAreas = areas.map(
    (a) => `- **${a.label}** · ${a.estado} — ${a.razon}`,
  );

  const roadmap = hitos.map(
    (h, i) =>
      `${i + 1}. **${h.titulo}** _(${h.areaSlug}${h.origen === 'abogado_del_diablo' ? ', detectado en la entrevista' : ''})_`,
  );

  const cuerpo = [
    `# ${e.giro ? `${e.giro}` : 'Mi negocio'}\n`,
    'Documento madre generado por el Ritual de Fundación. Es lo que el agente sabe del negocio.\n',
    seccion('Identidad', lista(identidad)),
    seccion('Modelo de negocio', lista(modelo)),
    seccion('Cómo llega y se atiende a un cliente hoy', recorrido.join('\n') || null),
    seccion(
      'Herramientas que usa hoy',
      lista(e.herramientas ?? []),
    ),
    seccion('Qué le roba tiempo y dinero', lista(dolores)),
    seccion('Gente', lista(gente)),
    seccion('Mapa de áreas', mapaAreas.join('\n') || null),
    seccion('Lo que sigue', roadmap.join('\n') || null),
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  return cuerpo.trim();
}

// ════════════════════════════════════════════════════════════════════════════
// El mapa completo
// ════════════════════════════════════════════════════════════════════════════

/**
 * El mensaje de cierre, escrito sin modelo.
 *
 * Es el respaldo del pago emocional. Si el proveedor se cae justo en el último
 * turno —el único que el emprendedor va a recordar— igual recibe su mapa, con
 * sus datos y sus razones. Cuando el modelo sí responde, éste no se usa: la
 * versión del agente es más cálida y va con su voz. Pero no puede ser la única.
 */
export function mensajeDeEntrega(mapa: MapaDeNegocio, e: EstadoNegocio): string {
  const nombre = e.agente?.trim();
  const disponibles = mapa.areas.filter((a) => a.estado !== 'bloqueada');
  const bloqueadas = mapa.areas.filter((a) => a.estado === 'bloqueada');
  const primero = mapa.hitos[0];

  const bloques: string[] = [];

  // Se arma como una frase, no como una lista pegada con espacios: el ticket
  // entra con coma y sin ella el renglón queda con un " ," suelto, que es
  // justo el detalle que hace que un cierre cuidado se lea descuidado.
  const cobro = [
    e.modeloIngreso ? `cobras ${e.modeloIngreso}` : null,
    e.ticket ? `alrededor de ${e.ticket}` : null,
  ].filter((x): x is string => x !== null);

  const frase = [
    e.giro ? `Te dedicas a ${e.giro}` : null,
    e.nicho ? `para ${e.nicho}` : null,
    cobro.length > 0 ? `y ${cobro.join(', ')}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' ');

  bloques.push(
    frase
      ? `Listo. Esto es tu negocio como lo entendí:\n\n${frase}.`
      : 'Listo. Esto es lo que armamos con lo que me contaste.',
  );

  if (disponibles.length > 0) {
    bloques.push(
      `**Puedes empezar hoy con:**\n${disponibles
        .map((a) => `· **${a.label}** — ${a.razon}`)
        .join('\n')}`,
    );
  }

  if (bloqueadas.length > 0) {
    bloques.push(
      `**Todavía no, pero te esperan:**\n${bloqueadas
        .map((a) => `· **${a.label}** — ${a.blurb} ${a.razon}`)
        .join('\n')}`,
    );
  }

  if (primero) {
    bloques.push(`**Por dónde empezar mañana:** ${primero.titulo}.`);
  }

  bloques.push(
    'Ya puedes entrar a usar tu sistema. Lo que falta no te bloquea: se va abriendo conforme avances.',
  );

  if (nombre) bloques.push(`— ${nombre}`);

  return bloques.join('\n\n');
}

/**
 * El mapa completo.
 *
 * `plantillas` son las filas de `app.industry_templates` que existen hoy; las
 * lee `plantillasDeGiro()` justo antes de cerrar. Se pasan como argumento y no
 * se consultan aquí adentro para que esta función siga siendo pura: el criterio
 * #4 —dos giros distintos, dos mapas distintos— se verifica con dos objetos y
 * cero tokens, y ahora también sin base.
 *
 * Sin catálogo (el default), `industryType` sale `null`. Nunca un slug
 * inventado: ver el encabezado de `synthesis/industria.ts`.
 */
export function construirMapa(
  e: EstadoNegocio,
  plantillas: PlantillaDeGiro[] = [],
): MapaDeNegocio {
  const areas = areasPara(e);
  const hitos = hitosPara(e, areas);
  return {
    industryType: tipoDeIndustria(e, plantillas),
    areas,
    hitos,
    resumen: resumenDelNegocio(e, areas, hitos),
  };
}
