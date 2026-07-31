-- ═══════════════════════════════════════════════════════════════════════════
--  033_industry_templates.sql — H4 · La Bóveda (4/4): taxonomías por giro
--
--  POR QUÉ ESTA TABLA EXISTE.
--
--  En GARDEN la taxonomía estaba HARDCODEADA con las ocho empresas de Santiago
--  (`inperio: 'property'`, `carineeto: 'franchise'`, `rito: 'agency'`…) en
--  src/vault/area-templates.ts. Eso funciona cuando tus clientes son tú mismo.
--  Con clientes de verdad, dar de alta un giro nuevo sería un commit y un
--  deploy.
--
--  Aquí el giro es UNA FILA. `app.tenants.industry_type` apunta a `id`, y H7
--  lo asigna cuando la entrevista descubre a qué se dedica el negocio.
--
--  El contenido está des-inperiado por completo: cero property management,
--  cero vocabulario inmobiliario. Cinco giros de PyME mexicana y su lenguaje
--  real — IVA, ticket promedio, anticipo, días de crédito, merma.
--
--  FORMA DE LOS CAMPOS JSON:
--    areas           [{ slug, label, icon, position, blurb }]
--    expected_docs   [{ area_slug, doc_type, title, hint }]
--    expected_values [{ area_slug, key, kind, hint }]
--
--  `detectGaps()` compara esto contra lo que el tenant realmente tiene. Es lo
--  que le permite al agente maestro decir "todavía no me has dicho cuánto
--  cobras" en vez de inventarse una cifra.
-- ═══════════════════════════════════════════════════════════════════════════

-- tenantless: catálogo de la plataforma. Es el mismo para todos los clientes
-- y existe antes que cualquier tenant.
CREATE TABLE app.industry_templates (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  blurb           text NOT NULL DEFAULT '',
  areas           jsonb NOT NULL DEFAULT '[]',
  expected_docs   jsonb NOT NULL DEFAULT '[]',
  expected_values jsonb NOT NULL DEFAULT '[]',
  position        int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.industry_templates ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER industry_templates_touch_updated_at
  BEFORE UPDATE ON app.industry_templates
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
--  Siembra. Idempotente: correr la migración dos veces no duplica ni pisa
--  ediciones hechas desde el producto salvo en los campos del catálogo.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO app.industry_templates (id, name, blurb, position, areas, expected_docs, expected_values)
VALUES

-- ── 1. Servicios profesionales ─────────────────────────────────────────────
(
  'servicios',
  'Servicios profesionales',
  'Despachos, consultorios, talleres, salones, estudios. Cobras por tu trabajo o por hora.',
  1,
  $json$[
    {"slug":"ventas","label":"Ventas","icon":"Target","position":1,
     "blurb":"De la primera llamada al si. Cotizaciones, seguimiento y cierre."},
    {"slug":"operaciones","label":"Operaciones","icon":"Wrench","position":2,
     "blurb":"Como se entrega el servicio: agenda, proceso y estandar de calidad."},
    {"slug":"servicio","label":"Atencion a clientes","icon":"HeartHandshake","position":3,
     "blurb":"Post-venta, quejas, garantias y recompra."},
    {"slug":"finanzas","label":"Finanzas","icon":"Wallet","position":4,
     "blurb":"Ingresos, gastos, margen y lo que le debes al SAT."},
    {"slug":"direccion","label":"Direccion","icon":"Compass","position":9,
     "blurb":"Tu boveda: los numeros, los documentos y la biblioteca del negocio."}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","doc_type":"precios","title":"Lista de precios y paquetes",
     "hint":"Cuanto cobras por cada servicio"},
    {"area_slug":"ventas","doc_type":"guion","title":"Guion de la primera llamada"},
    {"area_slug":"ventas","doc_type":"plantilla","title":"Cotizacion",
     "hint":"El machote que mandas; puede usar {valor.*}"},
    {"area_slug":"ventas","doc_type":"faq","title":"Objeciones frecuentes"},
    {"area_slug":"operaciones","doc_type":"sop","title":"Como se entrega el servicio",
     "hint":"Paso a paso, de la contratacion a la entrega"},
    {"area_slug":"operaciones","doc_type":"politica","title":"Politica de agenda y cancelaciones"},
    {"area_slug":"servicio","doc_type":"politica","title":"Garantia y devoluciones"},
    {"area_slug":"finanzas","doc_type":"politica","title":"Formas de pago y facturacion"},
    {"area_slug":"direccion","doc_type":"otro","title":"A que se dedica el negocio",
     "hint":"En tus palabras: que vendes, a quien y por que a ti"}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","key":"ticket_promedio","kind":"money",
     "hint":"Cuanto deja en promedio un cliente"},
    {"area_slug":"ventas","key":"precio_hora","kind":"money","hint":"Si cobras por hora"},
    {"area_slug":"ventas","key":"anticipo_pct","kind":"percent",
     "hint":"Que porcentaje pides por adelantado"},
    {"area_slug":"ventas","key":"primer_contacto_max_horas","kind":"number",
     "hint":"En cuantas horas contestas un prospecto nuevo"},
    {"area_slug":"operaciones","key":"tiempo_entrega_dias","kind":"number"},
    {"area_slug":"operaciones","key":"horario_atencion","kind":"text",
     "hint":"Ej. lunes a viernes de 9 a 6"},
    {"area_slug":"operaciones","key":"capacidad_semanal","kind":"number",
     "hint":"Cuantos clientes o proyectos aguantas por semana"},
    {"area_slug":"servicio","key":"garantia_meses","kind":"number"},
    {"area_slug":"finanzas","key":"iva_pct","kind":"percent","hint":"16 en Mexico"},
    {"area_slug":"finanzas","key":"margen_objetivo_pct","kind":"percent"},
    {"area_slug":"finanzas","key":"dias_credito","kind":"number",
     "hint":"Cuantos dias le das a un cliente para pagar"},
    {"area_slug":"finanzas","key":"gasto_fijo_mensual","kind":"money",
     "hint":"Renta, nomina y servicios: lo que se paga vendas o no"}
  ]$json$::jsonb
),

-- ── 2. Comercio y tienda en línea ──────────────────────────────────────────
(
  'comercio',
  'Comercio y tienda en linea',
  'Vendes producto: local, tienda en linea, marketplace o las tres.',
  2,
  $json$[
    {"slug":"ventas","label":"Ventas","icon":"Target","position":1,
     "blurb":"Mostrador, pedidos y carrito. De la pregunta a la compra."},
    {"slug":"marketing","label":"Marketing","icon":"Megaphone","position":2,
     "blurb":"Como te encuentran: contenido, pauta, redes y promociones."},
    {"slug":"inventario","label":"Inventario","icon":"Boxes","position":3,
     "blurb":"Que tienes, que se acaba, a quien le compras y a como."},
    {"slug":"servicio","label":"Atencion a clientes","icon":"HeartHandshake","position":4,
     "blurb":"Envios, cambios, devoluciones y garantias."},
    {"slug":"finanzas","label":"Finanzas","icon":"Wallet","position":5,
     "blurb":"Margen por producto, gastos e impuestos."},
    {"slug":"direccion","label":"Direccion","icon":"Compass","position":9,
     "blurb":"Tu boveda: los numeros, los documentos y la biblioteca del negocio."}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","doc_type":"precios","title":"Lista de precios",
     "hint":"Producto por producto, con su costo"},
    {"area_slug":"ventas","doc_type":"guion","title":"Respuestas de venta por WhatsApp",
     "hint":"Lo que contestas a disponible? y cuanto cuesta?"},
    {"area_slug":"marketing","doc_type":"sop","title":"Calendario de publicaciones"},
    {"area_slug":"marketing","doc_type":"manual","title":"Identidad de marca",
     "hint":"Logo, colores y tono"},
    {"area_slug":"inventario","doc_type":"politica","title":"Proveedores y tiempos de resurtido"},
    {"area_slug":"inventario","doc_type":"sop","title":"Control de inventario y mermas"},
    {"area_slug":"servicio","doc_type":"politica","title":"Politica de envios",
     "hint":"Costo, zonas y tiempos"},
    {"area_slug":"servicio","doc_type":"politica","title":"Cambios y devoluciones"},
    {"area_slug":"finanzas","doc_type":"politica","title":"Formas de pago y facturacion"},
    {"area_slug":"direccion","doc_type":"otro","title":"A que se dedica el negocio"}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","key":"ticket_promedio","kind":"money"},
    {"area_slug":"ventas","key":"descuento_maximo_pct","kind":"percent",
     "hint":"Hasta donde puede bajar quien vende sin pedir permiso"},
    {"area_slug":"marketing","key":"presupuesto_pauta_mensual","kind":"money"},
    {"area_slug":"marketing","key":"canales_activos","kind":"list",
     "hint":"Ej. Instagram, WhatsApp, Mercado Libre"},
    {"area_slug":"inventario","key":"stock_minimo","kind":"number",
     "hint":"Cuando se resurte"},
    {"area_slug":"inventario","key":"merma_max_pct","kind":"percent"},
    {"area_slug":"inventario","key":"dias_resurtido","kind":"number"},
    {"area_slug":"servicio","key":"costo_envio","kind":"money"},
    {"area_slug":"servicio","key":"envio_gratis_desde","kind":"money"},
    {"area_slug":"servicio","key":"dias_devolucion","kind":"number"},
    {"area_slug":"finanzas","key":"iva_pct","kind":"percent","hint":"16 en Mexico"},
    {"area_slug":"finanzas","key":"margen_objetivo_pct","kind":"percent"},
    {"area_slug":"finanzas","key":"gasto_fijo_mensual","kind":"money"}
  ]$json$::jsonb
),

-- ── 3. Restaurante, cafetería o food truck ─────────────────────────────────
(
  'restaurante',
  'Restaurante y cafeteria',
  'Cocinas y vendes en el momento: local, para llevar o reparto.',
  3,
  $json$[
    {"slug":"ventas","label":"Ventas y piso","icon":"Store","position":1,
     "blurb":"Menu, precios, pedidos y apps de reparto."},
    {"slug":"operaciones","label":"Cocina y operacion","icon":"ChefHat","position":2,
     "blurb":"Recetas, tiempos, higiene y como se abre y se cierra."},
    {"slug":"inventario","label":"Insumos","icon":"Boxes","position":3,
     "blurb":"Proveedores, costo por platillo y merma."},
    {"slug":"marketing","label":"Marketing","icon":"Megaphone","position":4,
     "blurb":"Como llenas el local: redes, resenas y promociones."},
    {"slug":"finanzas","label":"Finanzas","icon":"Wallet","position":5,
     "blurb":"Costo de venta, nomina, renta y punto de equilibrio."},
    {"slug":"direccion","label":"Direccion","icon":"Compass","position":9,
     "blurb":"Tu boveda: los numeros, los documentos y la biblioteca del negocio."}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","doc_type":"precios","title":"Menu con precios"},
    {"area_slug":"ventas","doc_type":"politica","title":"Politica de reservaciones y reparto"},
    {"area_slug":"operaciones","doc_type":"manual","title":"Recetario",
     "hint":"Gramaje por platillo: es de donde sale el costo real"},
    {"area_slug":"operaciones","doc_type":"sop","title":"Apertura y cierre del local"},
    {"area_slug":"operaciones","doc_type":"sop","title":"Higiene y manejo de alimentos"},
    {"area_slug":"inventario","doc_type":"politica","title":"Proveedores y dias de pedido"},
    {"area_slug":"marketing","doc_type":"sop","title":"Calendario de publicaciones"},
    {"area_slug":"finanzas","doc_type":"precios","title":"Costeo por platillo"},
    {"area_slug":"direccion","doc_type":"otro","title":"A que se dedica el negocio"}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","key":"ticket_promedio","kind":"money"},
    {"area_slug":"ventas","key":"horario_atencion","kind":"text"},
    {"area_slug":"ventas","key":"comision_app_reparto_pct","kind":"percent",
     "hint":"Lo que se queda Rappi, Uber Eats o DiDi"},
    {"area_slug":"operaciones","key":"tiempo_preparacion_min","kind":"number"},
    {"area_slug":"operaciones","key":"aforo","kind":"number","hint":"Cuantos comensales caben"},
    {"area_slug":"inventario","key":"costo_insumos_pct","kind":"percent",
     "hint":"Costo de venta sobre el precio; sano ronda 30"},
    {"area_slug":"inventario","key":"merma_max_pct","kind":"percent"},
    {"area_slug":"finanzas","key":"iva_pct","kind":"percent","hint":"16 en Mexico"},
    {"area_slug":"finanzas","key":"renta_mensual","kind":"money"},
    {"area_slug":"finanzas","key":"nomina_mensual","kind":"money"},
    {"area_slug":"finanzas","key":"punto_equilibrio_mensual","kind":"money",
     "hint":"Cuanto tienes que vender al mes para no perder"}
  ]$json$::jsonb
),

-- ── 4. Agencia o estudio ───────────────────────────────────────────────────
(
  'agencia',
  'Agencia o estudio',
  'Vendes trabajo por proyecto o por iguala: marketing, diseno, software, contabilidad.',
  4,
  $json$[
    {"slug":"ventas","label":"Ventas","icon":"Target","position":1,
     "blurb":"Propuestas, igualas y cierre de cuentas nuevas."},
    {"slug":"marketing","label":"Marketing propio","icon":"Megaphone","position":2,
     "blurb":"Tu propia demanda: portafolio, contenido y referidos."},
    {"slug":"servicio","label":"Cuentas","icon":"HeartHandshake","position":3,
     "blurb":"Clientes activos: entregables, juntas y reportes."},
    {"slug":"operaciones","label":"Produccion","icon":"Wrench","position":4,
     "blurb":"Como se produce el trabajo: flujo, revisiones y entrega."},
    {"slug":"finanzas","label":"Finanzas","icon":"Wallet","position":5,
     "blurb":"Rentabilidad por cuenta, cobranza y costo por hora."},
    {"slug":"direccion","label":"Direccion","icon":"Compass","position":9,
     "blurb":"Tu boveda: los numeros, los documentos y la biblioteca del negocio."}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","doc_type":"precios","title":"Tabulador de servicios e igualas"},
    {"area_slug":"ventas","doc_type":"plantilla","title":"Propuesta comercial"},
    {"area_slug":"ventas","doc_type":"contrato","title":"Contrato de prestacion de servicios",
     "hint":"Machote renderizable con {valor.*}"},
    {"area_slug":"ventas","doc_type":"faq","title":"Objeciones frecuentes"},
    {"area_slug":"servicio","doc_type":"sop","title":"Alta de cliente nuevo",
     "hint":"De la firma a la primera entrega"},
    {"area_slug":"servicio","doc_type":"plantilla","title":"Reporte mensual de resultados"},
    {"area_slug":"operaciones","doc_type":"sop","title":"Flujo de produccion y revisiones",
     "hint":"Cuantas rondas de cambios entran en el precio"},
    {"area_slug":"finanzas","doc_type":"politica","title":"Cobranza y penalizacion por atraso"},
    {"area_slug":"direccion","doc_type":"otro","title":"A que se dedica el negocio"}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","key":"iguala_mensual_minima","kind":"money"},
    {"area_slug":"ventas","key":"precio_hora","kind":"money"},
    {"area_slug":"ventas","key":"anticipo_pct","kind":"percent"},
    {"area_slug":"ventas","key":"comision_vendedor_pct","kind":"percent"},
    {"area_slug":"servicio","key":"rondas_revision_incluidas","kind":"number",
     "hint":"De aqui salen casi todos los pleitos con clientes"},
    {"area_slug":"servicio","key":"tiempo_respuesta_horas","kind":"number"},
    {"area_slug":"operaciones","key":"capacidad_proyectos_simultaneos","kind":"number"},
    {"area_slug":"finanzas","key":"iva_pct","kind":"percent","hint":"16 en Mexico"},
    {"area_slug":"finanzas","key":"retencion_isr_pct","kind":"percent",
     "hint":"Si facturas a persona moral"},
    {"area_slug":"finanzas","key":"dias_credito","kind":"number"},
    {"area_slug":"finanzas","key":"margen_objetivo_pct","kind":"percent"},
    {"area_slug":"finanzas","key":"gasto_fijo_mensual","kind":"money"}
  ]$json$::jsonb
),

-- ── 5. General (el que se usa mientras H7 no descubre el giro) ─────────────
(
  'general',
  'Otro giro',
  'Lo minimo que todo negocio necesita tener claro, sea cual sea su giro.',
  9,
  $json$[
    {"slug":"ventas","label":"Ventas","icon":"Target","position":1,
     "blurb":"Como llega un cliente y como se cierra la venta."},
    {"slug":"operaciones","label":"Operaciones","icon":"Wrench","position":2,
     "blurb":"Como se entrega lo que vendes."},
    {"slug":"finanzas","label":"Finanzas","icon":"Wallet","position":3,
     "blurb":"Que entra, que sale y cuanto queda."},
    {"slug":"direccion","label":"Direccion","icon":"Compass","position":9,
     "blurb":"Tu boveda: los numeros, los documentos y la biblioteca del negocio."}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","doc_type":"precios","title":"Lista de precios"},
    {"area_slug":"ventas","doc_type":"guion","title":"Que le dices a un cliente nuevo"},
    {"area_slug":"operaciones","doc_type":"sop","title":"Como se entrega lo que vendes"},
    {"area_slug":"finanzas","doc_type":"politica","title":"Formas de pago y facturacion"},
    {"area_slug":"direccion","doc_type":"otro","title":"A que se dedica el negocio",
     "hint":"En tus palabras: que vendes, a quien y por que a ti"}
  ]$json$::jsonb,
  $json$[
    {"area_slug":"ventas","key":"ticket_promedio","kind":"money"},
    {"area_slug":"ventas","key":"horario_atencion","kind":"text"},
    {"area_slug":"operaciones","key":"tiempo_entrega_dias","kind":"number"},
    {"area_slug":"finanzas","key":"iva_pct","kind":"percent","hint":"16 en Mexico"},
    {"area_slug":"finanzas","key":"margen_objetivo_pct","kind":"percent"},
    {"area_slug":"finanzas","key":"gasto_fijo_mensual","kind":"money"}
  ]$json$::jsonb
)

ON CONFLICT (id) DO UPDATE SET
  name            = EXCLUDED.name,
  blurb           = EXCLUDED.blurb,
  areas           = EXCLUDED.areas,
  expected_docs   = EXCLUDED.expected_docs,
  expected_values = EXCLUDED.expected_values,
  position        = EXCLUDED.position;


COMMENT ON TABLE app.industry_templates IS
  'Taxonomia por giro. app.tenants.industry_type apunta a id. En GARDEN esto '
  'estaba hardcodeado con las 8 empresas de ABRAXA; aqui un giro nuevo es una '
  'fila, no un deploy.';
