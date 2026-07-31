-- Migración de PRUEBA: 055 es de H7, no de H6. Y la tabla no lleva tenant_id ni RLS.
CREATE TABLE app.cosas_sueltas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL
);
