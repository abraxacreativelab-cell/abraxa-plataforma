/**
 * ¿Hay algún modelo en uso sin precio capturado?
 *
 * Éste es el guardián que GARDEN no tuvo. Su tabla de costos tenía 8 modelos y
 * un fallback silencioso de {input:1.0, output:3.0} para todo lo demás, así que
 * un modelo nuevo simplemente se cobraba mal — sin error, sin alarma, sin
 * ninguna forma de enterarse hasta que alguien sumara a mano.
 *
 * ── Los dos guardianes, y por qué hacen falta los dos ──────────────────────
 *
 * Este guion existía desde el primer día y NO ESTABA CABLEADO a nada: ni a un
 * script de package.json ni a CI. Un guardián que nadie invoca es documentación.
 * Eso, más un comentario en la migración 021 que prometía una prueba que no
 * existía, es lo que dejó a `claude-sonnet-4-6` meses en el catálogo sin precio.
 *
 *   · `pricing/seeds.test.ts` corre en `npm test` —o sea, en CI, en cada PR— y
 *     cruza el catálogo del CÓDIGO contra las semillas de `migrations/`. No
 *     necesita base. Es el freno que impide que el hueco se abra.
 *   · Este guion corre contra la BASE REAL y ve algo que la prueba no puede
 *     ver: los modelos que los CLIENTES pusieron en sus filas de
 *     `app.agent_definitions`, que ningún archivo del repo conoce. Es el freno
 *     del despliegue.
 *
 * Uso (desde packages/agents, con el entorno de la base cargado):
 *   npm run check:pricing
 *
 * Devuelve 1 si falta algún precio.
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
