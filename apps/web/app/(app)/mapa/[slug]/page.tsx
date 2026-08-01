import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { PlatformError } from '@abraxa/db';
import { areaOnboarding, type OnboardingView } from '@abraxa/areas';
import { Button, EmptyState } from '@abraxa/ui';
import { contextoDelMapa, motivoSinContexto } from '../context';
import { mapaDemo } from '../demo';
import { Tutorial } from './ui/tutorial';

export const metadata: Metadata = { title: 'Configurar área · ABRAXA Plataforma' };

/** Igual que `/mapa`: depende de la sesión, así que nunca se prerenderiza. */
export const dynamic = 'force-dynamic';


/**
 * `/mapa/[slug]` — el mini-onboarding de un área (H11, handoff §6).
 *
 * Es a donde lleva el mapa cuando el área todavía no tiene una pantalla propia
 * registrada, y es lo que se dispara al desbloquear (criterio 4).
 *
 * Componente de SERVIDOR: arma el contexto, lee el guion del catálogo y la
 * corrida en curso, y entrega la conversación en el punto donde quedó.
 */
export default async function Page({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const ctx = await contextoDelMapa();

  if (ctx) {
    try {
      const vista = await areaOnboarding.getOnboarding(ctx, slug);
      return <Tutorial inicial={vista} />;
    } catch (e) {
      // Un área que no está en SU mapa es un 404 de verdad, no un error: el
      // slug de otra empresa tampoco existe para él, y eso es lo correcto.
      if (e instanceof PlatformError && e.code === 'NOT_FOUND') notFound();
      throw e;
    }
  }

  // Mismo interruptor de desarrollo que `/mapa`. En producción ni se lee.
  if (process.env.NODE_ENV !== 'production' && cookies().get('abraxa_mapa_demo')?.value === '1') {
    const vista = vistaDemo(slug);
    if (!vista) notFound();
    return <Tutorial inicial={vista} />;
  }

  const motivo = motivoSinContexto();
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-24">
      <EmptyState icon="lock" title={motivo.titulo} description={motivo.descripcion}>
        {motivo.accion && (
          <Button asChild>
            <Link href={motivo.accion.href}>{motivo.accion.texto}</Link>
          </Button>
        )}
      </EmptyState>
    </main>
  );
}

/**
 * El guion de demo. Sale del mismo catálogo que la pantalla real —los textos son
 * los de la 090— para que revisar el copy del tutorial no exija una base viva.
 */
function vistaDemo(slug: string): OnboardingView | null {
  const area = mapaDemo().areas.find((a) => a.slug === slug);
  if (!area) return null;

  const guiones: Record<string, { intro: string; promise: string; preguntas: string[]; result: string }> = {
    operaciones: {
      intro: 'Operaciones es cómo se entrega lo que vendes, escrito para que no dependa de tu memoria.',
      promise: 'Puedes irte una semana y el negocio entrega igual.',
      preguntas: [
        'Desde que te pagan, ¿qué pasa hasta que el cliente tiene lo suyo?',
        '¿En qué paso se atora más seguido?',
        '¿Qué parte sólo la sabes hacer tú?',
      ],
      result: 'Tu proceso de entrega, en pasos',
    },
    direccion: {
      intro: 'Dirección es la bóveda: lo que tu negocio da por cierto. Precios, márgenes, políticas.',
      promise: 'Cuando un dato vive aquí, tus agentes dejan de inventarlo.',
      preguntas: [
        '¿Cuánto cuesta lo que más vendes?',
        '¿Qué es lo que NUNCA vas a hacer por un cliente, aunque pague?',
        'De cada cien pesos que entran, ¿cuántos te quedas?',
      ],
      result: 'Tus tres primeros valores canónicos, listos para activar',
    },
  };

  const g = guiones[slug];

  return {
    areaSlug: area.slug,
    areaLabel: area.label,
    state: area.state,
    script: g
      ? {
          intro: g.intro,
          promise: g.promise,
          questions: g.preguntas.map((prompt, i) => ({ key: `q${i}`, prompt })),
          result: { kind: 'demo', label: g.result },
        }
      : { intro: '', promise: area.blurb, questions: [], result: null },
    run: null,
    question: null,
    readyToFinish: false,
  };
}
