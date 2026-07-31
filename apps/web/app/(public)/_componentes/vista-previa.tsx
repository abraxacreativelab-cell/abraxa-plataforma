import { Badge, Card, CardContent } from '@abraxa/ui';

/**
 * Cómo se ve el producto.
 *
 * ── Por qué esto es una ilustración y lo dice ──────────────────────────────
 *
 * El handoff pide "capturas reales, no mockups", y tiene razón: nada vende
 * como algo que de verdad está funcionando. Pero el producto todavía no tiene
 * un cliente piloto en producción, así que no existe una captura real que
 * poner. Las dos salidas honestas eran dejar el hueco o mostrar una
 * ilustración diciendo que lo es. Un render presentado como captura sería
 * mentir en la página de venta, que es el peor lugar para empezar una
 * relación.
 *
 * Está construida con los mismos componentes y tokens del producto, así que
 * no es un dibujo: es la interfaz de verdad con datos de ejemplo. En cuanto
 * haya un piloto, esta sección se reemplaza por sus capturas.
 *
 * Componente de servidor: no hay estado ni interacción, y no tiene por qué
 * costarle JavaScript a un teléfono de gama media.
 */
export function VistaPrevia() {
  return (
    <figure className="m-0">
      <Card className="glass overflow-hidden">
        <CardContent className="p-0">
          {/* Barra del hilo */}
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">Marisol Herrera</p>
              <p className="truncate text-xs text-muted-foreground">WhatsApp · hace 2 minutos</p>
            </div>
            <Badge variant="outline" className="shrink-0">
              Contestado por tu agente
            </Badge>
          </div>

          {/* La conversación */}
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            {CONVERSACION.map((m, i) => (
              <div
                key={i}
                className={m.de === 'cliente' ? 'flex justify-start' : 'flex justify-end'}
              >
                <p
                  className={[
                    'max-w-[85%] text-pretty rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]',
                    m.de === 'cliente'
                      ? 'rounded-bl-sm bg-secondary text-secondary-foreground'
                      : 'rounded-br-sm border border-[hsl(var(--glow)/0.35)] bg-[hsl(var(--glow)/0.08)] text-foreground',
                  ].join(' ')}
                >
                  {m.texto}
                </p>
              </div>
            ))}
          </div>

          {/* Lo que el agente hizo además de contestar */}
          <div className="border-t border-border/60 px-4 py-3 sm:px-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Y sin que se lo pidieras
            </p>
            <ul className="mt-2 space-y-1.5">
              {ACCIONES.map((a) => (
                <li key={a} className="flex gap-2 text-sm text-muted-foreground">
                  <span aria-hidden="true" className="text-[hsl(var(--color-success-fg))]">
                    ✓
                  </span>
                  <span className="text-pretty">{a}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <figcaption className="mt-3 text-sm text-muted-foreground">
        Ilustración con datos de ejemplo, hecha con los componentes reales del producto. Todavía no
        tenemos capturas de un cliente en operación — cuando las tengamos, van aquí.
      </figcaption>
    </figure>
  );
}

const CONVERSACION = [
  { de: 'cliente', texto: '¿Tienen pastel de tres leches para mañana? Somos como 20.' },
  {
    de: 'agente',
    texto:
      '¡Claro! Para 20 personas te recomiendo el de 30 cm — $650. Si lo apartas hoy te lo tengo listo mañana a partir de las 11. ¿Te lo aparto?',
  },
  { de: 'cliente', texto: 'Sí porfa. ¿Aceptan transferencia?' },
  {
    de: 'agente',
    texto: 'Sí. Te paso los datos y en cuanto me confirmes lo dejo agendado a tu nombre.',
  },
] as const;

const ACCIONES = [
  'Agendó el pedido para mañana a las 11:00.',
  'Guardó a Marisol con su teléfono y lo que pidió.',
  'Te dejó una nota: confirmar el pago antes de hornear.',
];
