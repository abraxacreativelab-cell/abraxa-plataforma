#!/usr/bin/env tsx
/**
 * ¿Hay algún modelo en uso sin precio capturado?
 *
 * Éste es el guardián que GARDEN no tuvo. Su tabla de costos tenía 8 modelos y
 * un fallback silencioso de {input:1.0, output:3.0} para todo lo demás, así que
 * un modelo nuevo simplemente se cobraba mal — sin error, sin alarma, sin
 * ninguna forma de enterarse hasta que alguien sumara a mano.
 *
 * Aquí un modelo sin precio se registra con `cost_source='unpriced'` y costo 0,
 * y esto lo saca a la luz. Corre contra la base real, así que ve tanto los
 * modelos que el catálogo conoce como los que los clientes hayan puesto en sus
 * filas de `app.agent_definitions`.
 *
 * Uso:
 *   npx tsx packages/agents/src/bin/check-pricing.ts
 *
 * Devuelve 1 si falta algún precio. Pensado para correr en el despliegue.
 */
/* eslint-disable no-console -- guion de línea de comandos: su salida ES el reporte. */
// adminDb() y no tenantDb(): revisa un catálogo global (app.model_pricing)
// contra las filas de TODOS los tenants. Es justo la consulta transversal que
// no se puede acotar a uno.
import { adminDb } from '@abraxa/db';
import { modelosConocidos } from '../capabilities';

interface Uso {
  provider: string;
  model: string;
  origen: string;
}

async function main(): Promise<void> {
  const hoy = new Date().toISOString().slice(0, 10);

  // 1. Lo que el código conoce.
  const enUso: Uso[] = modelosConocidos().map((model) => ({
    provider: 'anthropic',
    model,
    origen: 'catálogo de capabilities.ts',
  }));

  // 2. Lo que los clientes de verdad tienen configurado. Es lo que el catálogo
  //    no puede anticipar: alguien pudo poner un modelo nuevo en su fila.
  const { data, error } = await adminDb()
    .from('agent_definitions')
    .select('provider, model')
    .eq('enabled', true);

  if (error) {
    console.error(`✖ No se pudo leer app.agent_definitions: ${error.message}`);
    process.exit(1);
  }

  for (const f of (data as Array<{ provider: string; model: string }> | null) ?? []) {
    if (f.provider === 'local') continue; // los locales no cuestan tokens
    if (!enUso.some((u) => u.provider === f.provider && u.model === f.model)) {
      enUso.push({ ...f, origen: 'app.agent_definitions' });
    }
  }

  // 3. ¿Cuáles no tienen precio vigente?
  const sinPrecio: Uso[] = [];
  for (const u of enUso) {
    const { data: precio } = await adminDb()
      .from('model_pricing')
      .select('id')
      .eq('provider', u.provider)
      .eq('model', u.model)
      .lte('effective_from', hoy)
      .limit(1);

    if (((precio as unknown[] | null) ?? []).length === 0) sinPrecio.push(u);
  }

  console.log(`Modelos en uso: ${enUso.length}`);
  console.log(`Con precio vigente al ${hoy}: ${enUso.length - sinPrecio.length}`);

  if (sinPrecio.length === 0) {
    console.log('\n✔ Todos los modelos en uso tienen precio vigente.');
    process.exit(0);
  }

  console.error(`\n✖ ${sinPrecio.length} modelo(s) SIN PRECIO:\n`);
  for (const u of sinPrecio) {
    console.error(`  · ${u.provider}/${u.model}  (${u.origen})`);
  }
  console.error(`
  Su consumo se está registrando con cost_source='unpriced' y costo 0. Los
  TOKENS sí quedan guardados, así que en cuanto captures el precio en
  app.model_pricing puedes recalcular hacia atrás — que es exactamente lo que
  en GARDEN no se podía hacer.`);
  process.exit(1);
}

void main();
