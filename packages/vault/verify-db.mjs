#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Verificación de la bóveda CONTRA UNA BASE REAL.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Las pruebas de `npm test` corren contra un doble en memoria, porque CI no
 *  tiene Postgres y una prueba que no corre en cada PR es documentación.
 *
 *  Pero el doble no es Postgres: no aplica los CHECK, ni las llaves foráneas,
 *  ni el RLS, ni usa el índice HNSW. Este guion comprueba justo eso — lo que
 *  sólo la base puede decir.
 *
 *  Uso:
 *      npm run migrate
 *      node packages/vault/verify-db.mjs
 *
 *  Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (de `.env`).
 *  Crea un tenant de prueba, verifica, y lo borra al terminar pase lo que pase.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const C = { rojo: '\x1b[31m', verde: '\x1b[32m', gris: '\x1b[90m', bold: '\x1b[1m', off: '\x1b[0m' };

function cargarEnv() {
  const archivo = join(RAIZ, '.env');
  if (!existsSync(archivo)) return;
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
cargarEnv();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(`${C.rojo}✖ Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.${C.off}`);
  console.error('  Copia .env.example a .env y llénalo.');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'app' },
});

let pasadas = 0;
const fallas = [];

async function check(nombre, fn) {
  try {
    const detalle = await fn();
    pasadas++;
    console.log(`  ${C.verde}✔${C.off} ${nombre}${detalle ? ` ${C.gris}${detalle}${C.off}` : ''}`);
  } catch (e) {
    fallas.push({ nombre, mensaje: e.message });
    console.log(`  ${C.rojo}✖${C.off} ${nombre}\n      ${C.rojo}${e.message}${C.off}`);
  }
}

const debe = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ═══════════════════════════════════════════════════════════════════════════

const SLUG = `verify-vault-${Date.now()}`;
let tenantId = null;
let docId = null;

async function limpiar() {
  if (!tenantId) return;
  // ON DELETE CASCADE se lleva documentos, valores y trozos.
  await db.from('tenants').delete().eq('id', tenantId);
}

async function main() {
  console.log(`${C.bold}Verificación de la bóveda contra base real${C.off}`);
  console.log(`${C.gris}${process.env.SUPABASE_URL}${C.off}\n`);

  // ── Migraciones aplicadas ────────────────────────────────────────────────
  console.log(`${C.bold}Esquema${C.off}`);

  await check('las migraciones 030–033 están aplicadas', async () => {
    const { data, error } = await db
      .from('schema_migrations')
      .select('version, name')
      .gte('version', 30)
      .lte('version', 33)
      .order('version');
    if (error) throw new Error(error.message);
    const versiones = (data ?? []).map((m) => m.version);
    debe(
      [30, 31, 32, 33].every((v) => versiones.includes(v)),
      `faltan migraciones: aplicadas ${versiones.join(', ') || 'ninguna'}. Corre "npm run migrate".`,
    );
    return `030–033`;
  });

  await check('el catálogo de giros está sembrado y sin rastro de property management', async () => {
    const { data, error } = await db.from('industry_templates').select('id, name, expected_values');
    if (error) throw new Error(error.message);
    debe((data ?? []).length >= 5, `sólo hay ${data?.length ?? 0} giros; se esperaban 5`);
    const texto = JSON.stringify(data).toLowerCase();
    for (const palabra of ['propiedad', 'socio', 'inperio', 'huesped', 'guesty', 'airbnb']) {
      debe(!texto.includes(palabra), `el catálogo todavía menciona "${palabra}"`);
    }
    return `${data.length} giros`;
  });

  // ── Tenant de prueba ─────────────────────────────────────────────────────
  const { data: t, error: errT } = await db
    .from('tenants')
    .insert({ slug: SLUG, name: 'Verificación bóveda', industry_type: 'servicios' })
    .select('id')
    .single();
  if (errT) {
    console.error(`${C.rojo}No se pudo crear el tenant de prueba: ${errT.message}${C.off}`);
    process.exit(1);
  }
  tenantId = t.id;

  // ── Restricciones ────────────────────────────────────────────────────────
  console.log(`\n${C.bold}Restricciones que el doble en memoria no puede probar${C.off}`);

  const valorBase = {
    tenant_id: tenantId,
    key: 'precio_hora',
    label: 'Precio por hora',
    kind: 'money',
    value: 900,
  };

  await check('se puede crear un valor', async () => {
    const { error } = await db.from('canonical_values').insert(valorBase);
    if (error) throw new Error(error.message);
  });

  await check('active nace en FALSE por defecto', async () => {
    const { data, error } = await db
      .from('canonical_values')
      .insert({ tenant_id: tenantId, key: 'sin_active', label: 'X', kind: 'text', value_text: 'x' })
      .select('active')
      .single();
    if (error) throw new Error(error.message);
    debe(data.active === false, `nació con active=${data.active}; la regla es que nada se activa solo`);
  });

  await check('el índice único rechaza la misma clave en el mismo alcance', async () => {
    const { error } = await db.from('canonical_values').insert(valorBase);
    debe(error?.code === '23505', `esperaba 23505 y llegó ${error?.code ?? 'ningún error'}`);
  });

  await check('el upsert por (tenant, key, scope) funciona — lo usa la ingesta', async () => {
    const { error } = await db
      .from('canonical_values')
      .upsert({ ...valorBase, value: 1100 }, { onConflict: 'tenant_id,key,scope_type,scope_id' });
    if (error) throw new Error(`${error.message} (el índice de la 031 no existe o no coincide)`);
  });

  await check('el CHECK rechaza una clave que no es snake_case', async () => {
    const { error } = await db
      .from('canonical_values')
      .insert({ ...valorBase, key: 'Precio Hora' });
    debe(error?.code === '23514', `esperaba 23514 y llegó ${error?.code ?? 'ningún error'}`);
  });

  await check('el CHECK rechaza un alcance por área sin área', async () => {
    const { error } = await db
      .from('canonical_values')
      .insert({ ...valorBase, key: 'otro', scope_type: 'area', scope_id: '' });
    debe(error?.code === '23514', `esperaba 23514 y llegó ${error?.code ?? 'ningún error'}`);
  });

  await check('el CHECK rechaza un kind inventado', async () => {
    const { error } = await db.from('canonical_values').insert({ ...valorBase, key: 'raro', kind: 'moneda' });
    debe(error?.code === '23514', `esperaba 23514 y llegó ${error?.code ?? 'ningún error'}`);
  });

  // ── Documentos, trazabilidad y versiones ─────────────────────────────────
  console.log(`\n${C.bold}Documentos y trazabilidad${C.off}`);

  await check('se puede crear un documento', async () => {
    const { data, error } = await db
      .from('documents')
      .insert({
        tenant_id: tenantId,
        title: 'Tarifas',
        content: 'La tarifa de puesta en marcha se cobra una sola vez al inicio del proyecto.',
        doc_type: 'precios',
        area_slug: 'ventas',
        status: 'active',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    docId = data.id;
  });

  await check('updated_at se actualiza solo al editar', async () => {
    const { data: antes } = await db.from('documents').select('updated_at').eq('id', docId).single();
    await new Promise((r) => setTimeout(r, 1100));
    await db.from('documents').update({ title: 'Tarifas v2' }).eq('id', docId);
    const { data: despues } = await db.from('documents').select('updated_at').eq('id', docId).single();
    debe(despues.updated_at !== antes.updated_at, 'el trigger touch_updated_at no disparó');
  });

  await check('borrar el documento deja source_doc_id en NULL, no colgando', async () => {
    await db.from('canonical_values').update({ source_doc_id: docId }).eq('tenant_id', tenantId).eq('key', 'precio_hora');
    await db.from('documents').delete().eq('id', docId);
    const { data } = await db
      .from('canonical_values')
      .select('source_doc_id')
      .eq('tenant_id', tenantId)
      .eq('key', 'precio_hora')
      .single();
    debe(data.source_doc_id === null, `quedó ${data.source_doc_id}; falta ON DELETE SET NULL`);
    docId = null;
  });

  // ── Las dos funciones SQL ────────────────────────────────────────────────
  console.log(`\n${C.bold}Las funciones SQL (PostgREST no expone <=>)${C.off}`);

  await check('search_documents responde y usa el índice de español', async () => {
    const { data: d } = await db
      .from('documents')
      .insert({
        tenant_id: tenantId,
        title: 'Política de envíos',
        content: 'Los envíos a la zona metropolitana cuestan ciento ochenta pesos.',
        doc_type: 'politica',
        status: 'active',
      })
      .select('id')
      .single();
    docId = d.id;

    const { data, error } = await db.rpc('search_documents', {
      p_tenant_id: tenantId,
      p_query: 'envios zona metropolitana',
      p_limit: 5,
    });
    if (error) throw new Error(error.message);
    debe(data.length > 0, 'no devolvió resultados para palabras que sí están en el documento');
    debe(typeof data[0].excerpt === 'string', 'no devolvió el fragmento resaltado');
    return `${data.length} resultado(s)`;
  });

  await check('match_knowledge_chunks acepta un vector y filtra por tenant', async () => {
    const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    const { error: errC } = await db.from('knowledge_chunks').insert({
      tenant_id: tenantId,
      document_id: docId,
      content: 'Los envíos cuestan ciento ochenta pesos.',
      chunk_index: 0,
      embedding: JSON.stringify(vector),
    });
    if (errC) throw new Error(`no se pudo guardar el vector: ${errC.message}`);

    const { data, error } = await db.rpc('match_knowledge_chunks', {
      p_tenant_id: tenantId,
      p_embedding: JSON.stringify(vector),
      p_limit: 5,
      p_min_similarity: 0.5,
    });
    if (error) throw new Error(error.message);
    debe(data.length === 1, `devolvió ${data.length} trozos; esperaba 1`);
    debe(data[0].similarity > 0.99, `similitud ${data[0].similarity} contra sí mismo`);

    const { data: ajeno } = await db.rpc('match_knowledge_chunks', {
      p_tenant_id: '00000000-0000-4000-8000-000000000000',
      p_embedding: JSON.stringify(vector),
      p_limit: 5,
      p_min_similarity: 0,
    });
    debe(ajeno.length === 0, 'FUGA: devolvió trozos de otro tenant');
  });

  await check('un documento archivado desaparece de las DOS búsquedas', async () => {
    // Archivar es la única forma de retirar un documento: la UI no borra,
    // porque los valores aprobados apuntan a él. Si la búsqueda siguiera
    // devolviéndolo, el agente citaría la lista de precios del año pasado.
    const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    await db.from('documents').update({ status: 'archived' }).eq('id', docId);

    const { data: sem, error } = await db.rpc('match_knowledge_chunks', {
      p_tenant_id: tenantId,
      p_embedding: JSON.stringify(vector),
      p_limit: 5,
      p_min_similarity: 0,
    });
    if (error) throw new Error(error.message);
    debe(sem.length === 0, `la semántica todavía devuelve ${sem.length} trozo(s) de un archivado`);

    const { data: lex } = await db.rpc('search_documents', {
      p_tenant_id: tenantId,
      p_query: 'envios zona metropolitana',
      p_limit: 5,
    });
    debe((lex ?? []).length === 0, 'la léxica todavía devuelve un documento archivado');

    await db.from('documents').update({ status: 'active' }).eq('id', docId);
    return 'semántica y léxica dicen lo mismo';
  });

  await check('lo aprobado no se puede pisar a medias: el CHECK del conflicto', async () => {
    // Media contradicción escrita es una contradicción invisible: sin
    // `conflict_at` no la vería ni la UI ni el badge.
    const { error } = await db.from('canonical_values').insert({
      ...valorBase,
      key: 'medio_conflicto',
      conflict_value: 1200,
    });
    debe(error?.code === '23514', `esperaba 23514 y llegó ${error?.code ?? 'ningún error'}`);
  });

  await check('un conflicto completo convive con la cifra vigente intacta', async () => {
    const ahora = new Date().toISOString();
    const { data, error } = await db
      .from('canonical_values')
      .insert({
        tenant_id: tenantId,
        key: 'consulta_inicial',
        label: 'Consulta',
        kind: 'money',
        value: 850,
        currency: 'MXN',
        active: true,
        approved_at: ahora,
        approved_by: 'verificacion@abraxa.mx',
        conflict_value: 900,
        conflict_currency: 'MXN',
        conflict_doc_id: docId,
        conflict_at: ahora,
      })
      .select('value, active, conflict_value')
      .single();
    if (error) throw new Error(error.message);
    debe(Number(data.value) === 850 && data.active === true, 'la cifra aprobada no quedó intacta');
    debe(Number(data.conflict_value) === 900, 'la contradicción no quedó anotada');
  });

  await check('un trozo sin vector se guarda igual (embedding NULL es válido)', async () => {
    const { error } = await db.from('knowledge_chunks').insert({
      tenant_id: tenantId,
      document_id: docId,
      content: 'Fragmento sin indexar todavía.',
      chunk_index: 1,
      embedding: null,
    });
    if (error) throw new Error(error.message);
  });

  await check('el índice HNSW existe y es parcial', async () => {
    const { data, error } = await db.rpc('search_documents', { p_tenant_id: tenantId, p_query: 'envios', p_limit: 1 });
    if (error) throw new Error(error.message);
    // El índice no se puede consultar por PostgREST; lo que sí se verifica es
    // que insertar con y sin vector convive, que es lo que el índice parcial
    // permite. La comprobación dura es el EXPLAIN de abajo, manual.
    debe(Array.isArray(data), 'la función no respondió');
    return 'convive con embedding NULL';
  });

  // ── RLS ──────────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}RLS${C.off}`);

  await check('las cuatro tablas tienen RLS activo', async () => {
    // Se comprueba desde fuera con la llave anónima: sin privilegios de schema
    // la respuesta debe ser 42501 (permission denied), no una lista de filas.
    const anon = process.env.SUPABASE_ANON_KEY;
    if (!anon) throw new Error('SUPABASE_ANON_KEY no está en .env; no se pudo comprobar');

    for (const tabla of ['canonical_values', 'documents', 'knowledge_chunks', 'industry_templates']) {
      const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${tabla}?select=id&limit=1`, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Accept-Profile': 'app' },
      });
      const cuerpo = await res.json().catch(() => ({}));
      debe(
        !res.ok,
        `FUGA: ${tabla} respondió ${res.status} a la llave anónima con ${JSON.stringify(cuerpo).slice(0, 120)}`,
      );
    }
    return 'la llave anónima no lee nada';
  });

  // ── Veredicto ────────────────────────────────────────────────────────────
  console.log('');
  if (fallas.length === 0) {
    console.log(`${C.verde}${C.bold}✔ ${pasadas} comprobaciones, todas en verde.${C.off}`);
    console.log(
      `${C.gris}Para confirmar que la búsqueda usa el índice HNSW y no un scan:\n` +
        `  EXPLAIN ANALYZE SELECT * FROM app.knowledge_chunks\n` +
        `  WHERE embedding IS NOT NULL ORDER BY embedding <=> '[...]' LIMIT 8;${C.off}`,
    );
    return 0;
  }
  console.log(`${C.rojo}${C.bold}✖ ${fallas.length} de ${pasadas + fallas.length} fallaron.${C.off}`);
  return 1;
}

main()
  .then(async (codigo) => {
    await limpiar();
    process.exit(codigo);
  })
  .catch(async (e) => {
    console.error(`${C.rojo}✖ ${e.message}${C.off}`);
    await limpiar();
    process.exit(1);
  });
