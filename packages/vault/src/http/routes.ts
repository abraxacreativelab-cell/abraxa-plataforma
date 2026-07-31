/**
 * BÓVEDA · Rutas HTTP. Se montan en `/vault` (H1 ya lo cableó en apps/api).
 *
 * Todas resuelven el `TenantContext` con `TenancyPort` antes de tocar nada, y
 * todo acceso a datos va por `tenantDb(ctx)`. No hay una sola ruta que reciba
 * un `tenantId` por parámetro: si existiera, sería la puerta por donde se
 * fuga un cliente a otro.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { canEditVault } from '../rbac';
import {
  aprobarValor,
  borrarValor,
  contarBorradores,
  contarConflictos,
  crearValor,
  desactivarValor,
  editarValor,
  listarValores,
  obtenerValor,
  resolverConflicto,
} from '../values/service';
import {
  archivarDocumento,
  contarTrozosSinVector,
  crearDocumento,
  editarDocumento,
  excerptDe,
  listarDocumentos,
  listarVersiones,
  obtenerDocumento,
  obtenerVersion,
} from '../documents/service';
import { buscar } from '../documents/search';
import { embeddingsStatus } from '../documents/embeddings';
import { ingestDocument } from '../ingest/pipeline';
import { detectGapsDetallado } from '../industry/gaps';
import { listarGiros, taxonomiaDe } from '../industry/catalog';
import { loadTenantMeta } from '../global-tables';
import { renderTemplate, tokensUsados } from '../render';
import { resolveVault } from '../resolver';
import type { DocType } from '../types';
import { contextoDe } from './context';

export const router: Router = Router();

/** Express 4 no atrapa el rechazo de un handler async: se lo pasa al de errores. */
function h(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

const q = (req: Request, k: string): string | undefined => {
  const v = req.query[k];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

// ═══ Valores canónicos ══════════════════════════════════════════════════════

router.get(
  '/values',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const rows = await listarValores(ctx, {
      areaSlug: q(req, 'area') ?? undefined,
      soloBorradores: q(req, 'estado') === 'borrador',
      soloConflictos: q(req, 'estado') === 'conflicto',
      busqueda: q(req, 'q'),
    });
    res.json({ values: rows, canEdit: canEditVault(ctx) });
  }),
);

router.post(
  '/values',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    res.status(201).json(await crearValor(ctx, req.body));
  }),
);

router.get(
  '/values/:id',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    res.json(await obtenerValor(ctx, String(req.params.id)));
  }),
);

router.patch(
  '/values/:id',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    res.json(await editarValor(ctx, String(req.params.id), req.body));
  }),
);

/**
 * El clic que convierte una propuesta en un dato oficial.
 * Devuelve `propagado` para que la UI diga QUÉ se propagó, no un "listo".
 */
router.post(
  '/values/:id/approve',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    res.json(await aprobarValor(ctx, String(req.params.id)));
  }),
);

router.post(
  '/values/:id/unapprove',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    res.json(await desactivarValor(ctx, String(req.params.id)));
  }),
);

/**
 * Las dos salidas de una contradicción.
 *
 * Dos rutas explícitas y no un `PATCH` con un campo `decision`: aceptar cambia
 * un número que ya está en contratos y mensajes vivos. Que se lea en el log de
 * acceso qué se hizo, sin abrir el cuerpo de la petición.
 */
router.post(
  '/values/:id/conflict/accept',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    res.json(await resolverConflicto(ctx, String(req.params.id), 'aceptar'));
  }),
);

router.post(
  '/values/:id/conflict/discard',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    res.json(await resolverConflicto(ctx, String(req.params.id), 'descartar'));
  }),
);

router.delete(
  '/values/:id',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    await borrarValor(ctx, String(req.params.id));
    res.status(204).end();
  }),
);

/** El mapa ya resuelto y formateado. Es lo que ven los demás consumidores. */
router.get(
  '/resolve',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const area = q(req, 'area');
    const resuelto = await resolveVault(ctx, { area: area ?? null });
    res.json({ values: resuelto?.values ?? {}, count: Object.keys(resuelto?.values ?? {}).length });
  }),
);

/** Vista previa de una plantilla. Dice qué tokens quedaron sin resolver. */
router.post(
  '/render',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const template = String((req.body as { template?: unknown })?.template ?? '');
    const area = q(req, 'area');
    const { text, missing } = await renderTemplate(ctx, template, {
      vaultContext: { area: area ?? null },
    });
    res.json({ text, missing, tokens: tokensUsados(template) });
  }),
);

// ═══ Documentos y biblioteca ════════════════════════════════════════════════

router.get(
  '/documents',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const docs = await listarDocumentos(ctx, {
      areaSlug: q(req, 'area') ?? null,
      docType: q(req, 'tipo') as DocType | undefined,
      incluirArchivados: q(req, 'archivados') === 'true',
    });
    res.json({ documents: docs, canEdit: canEditVault(ctx) });
  }),
);

router.post(
  '/documents',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const doc = await crearDocumento(ctx, {
      title: String(b.title ?? ''),
      content: String(b.content ?? ''),
      docType: b.docType as DocType | undefined,
      areaSlug: b.areaSlug == null ? null : String(b.areaSlug),
      status: b.status === 'active' ? 'active' : 'draft',
      sourceKind: 'manual',
    });
    res.status(201).json(doc);
  }),
);

router.get(
  '/documents/:id',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const doc = await obtenerDocumento(ctx, String(req.params.id));
    res.json({ ...doc, excerpt: excerptDe(doc.content) });
  }),
);

router.patch(
  '/documents/:id',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    res.json(
      await editarDocumento(ctx, String(req.params.id), {
        title: b.title == null ? undefined : String(b.title),
        content: b.content == null ? undefined : String(b.content),
        docType: b.docType as DocType | undefined,
        areaSlug: b.areaSlug === undefined ? undefined : b.areaSlug == null ? null : String(b.areaSlug),
        status: b.status as 'draft' | 'active' | 'archived' | undefined,
      }),
    );
  }),
);

router.delete(
  '/documents/:id',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    // Archivar, no borrar: el documento es la fuente de verdad de los valores
    // que ya se aprobaron. Borrarlo dejaría cifras vivas sin de dónde salieron.
    res.json(await archivarDocumento(ctx, String(req.params.id)));
  }),
);

router.get(
  '/documents/:id/versions',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    res.json({ versions: await listarVersiones(ctx, String(req.params.id)) });
  }),
);

router.get(
  '/documents/:id/versions/:version',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    res.json(await obtenerVersion(ctx, String(req.params.id), Number(req.params.version)));
  }),
);

router.get(
  '/search',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const consulta = q(req, 'q') ?? '';
    const limite = Number(q(req, 'limite') ?? 8);
    res.json(await buscar(ctx, consulta, { limite: Number.isFinite(limite) ? limite : 8 }));
  }),
);

// ═══ Ingesta ════════════════════════════════════════════════════════════════

router.post(
  '/ingest',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const r = await ingestDocument(ctx, {
      content: String(b.content ?? ''),
      title: b.title == null ? undefined : String(b.title),
      areaSlug: b.areaSlug == null ? undefined : String(b.areaSlug),
      docType: b.docType as DocType | undefined,
      sourceKind: 'paste',
    });
    res.status(201).json(r);
  }),
);

// ═══ Giro, huecos y salud ═══════════════════════════════════════════════════

router.get(
  '/gaps',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const gaps = await detectGapsDetallado(ctx);
    res.json({
      gaps,
      total: gaps.reduce((n, g) => n + g.missingDocs.length + g.missingValues.length, 0),
    });
  }),
);

/** Las áreas del giro del tenant. La UI de Dirección agrupa con esto. */
router.get(
  '/industry',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const meta = await loadTenantMeta(ctx);
    const taxonomia = await taxonomiaDe(meta?.industryType);
    res.json({
      current: taxonomia.id,
      name: taxonomia.name,
      areas: taxonomia.areas,
      isDefault: !meta?.industryType,
    });
  }),
);

/** El catálogo de giros. Lo consume H7 en la entrevista. */
router.get(
  '/industries',
  h(async (_req, res) => {
    const giros = await listarGiros();
    res.json({
      industries: giros.map((g) => ({
        id: g.id,
        name: g.name,
        blurb: g.blurb,
        areas: g.areas.length,
      })),
    });
  }),
);

/**
 * Salud de la bóveda. Dice la verdad sobre lo que está degradado en vez de
 * devolver `ok: true` mientras el índice semántico lleva horas caído.
 */
router.get(
  '/health',
  h(async (req, res) => {
    const ctx = await contextoDe(req);
    const embeddings = embeddingsStatus();
    const [borradores, conflictos, sinVector] = await Promise.all([
      contarBorradores(ctx),
      contarConflictos(ctx),
      contarTrozosSinVector(ctx),
    ]);
    res.json({
      ok: true,
      embeddings,
      borradoresPendientes: borradores,
      // Distinto de un borrador y más urgente: aquí hay una cifra VIGENTE que
      // un documento posterior desmiente, y se sigue propagando mientras tanto.
      conflictosPendientes: conflictos,
      fragmentosSinIndexar: sinVector,
      ...(sinVector > 0
        ? { aviso: `${sinVector} fragmento(s) esperan indexado; la búsqueda por palabras sí los ve.` }
        : {}),
    });
  }),
);
