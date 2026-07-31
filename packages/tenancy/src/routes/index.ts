/**
 * Las rutas de H2. `apps/api` monta este router en `/tenants` (H1 lo cableó).
 *
 * ── Tres decisiones que no son obvias ─────────────────────────────────────
 *
 * 1. **No existe `GET /tenants/:slug`.** Sería una superficie de lectura
 *    transversal: un endpoint al que se le pide una empresa por nombre. Todo
 *    lo que se lee de la empresa activa sale de `req.tenant`, que ya pasó por
 *    la comprobación de membresía. Lo que no se puede pedir no se puede
 *    filtrar.
 *
 * 2. **`POST /tenants` ignora el `ownerEmail` del cuerpo.** El dueño es
 *    siempre el de la sesión verificada. Aceptarlo del cuerpo permitiría crear
 *    una empresa a nombre de otra persona, que es una forma elegante de
 *    regalarle una empresa a alguien — o de quitarle un slug.
 *
 * 3. **Aceptar una invitación NO pasa por `tenantMiddleware`.** Quien acepta
 *    todavía no es miembro: exigirle contexto de empresa sería pedirle que
 *    demuestre lo que está a punto de obtener.
 */
import { Router } from 'express';
import { PlatformError } from '@abraxa/db';
import {
  asyncHandler,
  contextoDe,
  requireProxySecret,
  sessionMiddleware,
  tenantMiddleware,
} from '../middleware/tenant';
import { requireTenantAdmin } from '../middleware/rbac';
import { canSignIn, tenantsFor, primaryTenantSlugFor } from '../services/context';
import { provision } from '../services/provision';
import { listMembers, removeMember, setAreas, setRole, upsertMember } from '../services/memberships';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from '../services/invitations';
import { availablePlans, limitsFor, seatsFor } from '../services/plans';

export const router: Router = Router();

// ═══ Servidor a servidor ═══════════════════════════════════════════════════
//
// Lo consume el `signIn` de NextAuth en el BFF. Se monta primero porque su
// autenticación es distinta: secreto compartido, sin sesión de usuario.

const internal = Router();
internal.use(requireProxySecret);

internal.get(
  '/has-access',
  asyncHandler(async (req, res) => {
    const email = String(req.query.email ?? '').trim().toLowerCase();
    if (!email) throw new PlatformError('VALIDATION', 'Falta el parámetro email.');
    // `canSignIn` es fail-closed por dentro: cualquier fallo devuelve false.
    res.json({ access: await canSignIn(email) });
  }),
);

internal.get(
  '/primary-tenant',
  asyncHandler(async (req, res) => {
    const email = String(req.query.email ?? '').trim().toLowerCase();
    if (!email) throw new PlatformError('VALIDATION', 'Falta el parámetro email.');
    res.json({ slug: await primaryTenantSlugFor(email) });
  }),
);

router.use('/internal', internal);

// ═══ Con sesión, sin empresa ═══════════════════════════════════════════════

/** Las empresas del usuario. Lo pinta el selector de empresa. */
router.get(
  '/mine',
  sessionMiddleware,
  asyncHandler(async (req, res) => {
    res.json({ tenants: await tenantsFor(contextoDe(req).userEmail ?? '') });
  }),
);

/**
 * Alta de una empresa. El dueño es quien está en la sesión, siempre.
 *
 * H10 (cobro) no llama por aquí: usa `TenancyPort.provision()` en proceso,
 * porque su disparador es un webhook de Stripe y no hay sesión de nadie.
 */
router.post(
  '/',
  sessionMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = contextoDe(req);
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;

    const resultado = await provision({
      slug: String(cuerpo.slug ?? ''),
      name: String(cuerpo.name ?? ''),
      ownerEmail: ctx.userEmail ?? '',
      ...(cuerpo.industryType ? { industryType: String(cuerpo.industryType) } : {}),
    });

    res.status(resultado.created ? 201 : 200).json(resultado);
  }),
);

/** Aceptar una invitación. Sin contexto de empresa a propósito. */
router.post(
  '/invitations/accept',
  sessionMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = contextoDe(req);
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;

    res.json(
      await acceptInvitation({
        token: String(cuerpo.token ?? ''),
        userEmail: ctx.userEmail ?? '',
        ...(cuerpo.name ? { name: String(cuerpo.name) } : {}),
      }),
    );
  }),
);

/** Catálogo de planes. Público dentro de la app: no revela nada de nadie. */
router.get(
  '/plans',
  sessionMiddleware,
  asyncHandler(async (_req, res) => {
    res.json({ plans: await availablePlans() });
  }),
);

// ═══ Dentro de una empresa ═════════════════════════════════════════════════
//
// A partir de aquí, todo pasa por `tenantMiddleware`: sin membresía, 403.

router.get(
  '/current',
  tenantMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = contextoDe(req);
    res.json({
      tenantId: ctx.tenantId,
      slug: ctx.tenantSlug,
      name: ctx.tenantName,
      status: ctx.tenantStatus,
      plan: ctx.plan,
      role: ctx.role,
      areas: ctx.areas,
      userEmail: ctx.userEmail,
    });
  }),
);

router.get(
  '/quotas',
  tenantMiddleware,
  asyncHandler(async (req, res) => {
    const ctx = contextoDe(req);
    const [asientos, limites] = await Promise.all([seatsFor(ctx), limitsFor(ctx)]);
    res.json({ plan: ctx.plan, limits: limites, seats: asientos });
  }),
);

// ─── Miembros ─────────────────────────────────────────────────────────────

router.get(
  '/members',
  tenantMiddleware,
  asyncHandler(async (req, res) => {
    res.json({ members: await listMembers(contextoDe(req)) });
  }),
);

router.put(
  '/members/:email',
  tenantMiddleware,
  requireTenantAdmin(),
  asyncHandler(async (req, res) => {
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;
    res.json(await upsertMember(contextoDe(req), String(req.params.email), cuerpo.role ?? 'viewer'));
  }),
);

router.patch(
  '/members/:email/role',
  tenantMiddleware,
  requireTenantAdmin(),
  asyncHandler(async (req, res) => {
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;
    res.json(await setRole(contextoDe(req), String(req.params.email), cuerpo.role));
  }),
);

router.patch(
  '/members/:email/areas',
  tenantMiddleware,
  requireTenantAdmin(),
  asyncHandler(async (req, res) => {
    res.json(await setAreas(contextoDe(req), String(req.params.email), req.body));
  }),
);

router.delete(
  '/members/:email',
  tenantMiddleware,
  requireTenantAdmin(),
  asyncHandler(async (req, res) => {
    res.json(await removeMember(contextoDe(req), String(req.params.email)));
  }),
);

// ─── Invitaciones ─────────────────────────────────────────────────────────

router.get(
  '/invitations',
  tenantMiddleware,
  requireTenantAdmin(),
  asyncHandler(async (req, res) => {
    res.json({ invitations: await listInvitations(contextoDe(req)) });
  }),
);

router.post(
  '/invitations',
  tenantMiddleware,
  requireTenantAdmin(),
  asyncHandler(async (req, res) => {
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;
    const invitacion = await createInvitation(contextoDe(req), {
      email: String(cuerpo.email ?? ''),
      ...(cuerpo.role ? { role: cuerpo.role as never } : {}),
      ...(cuerpo.areas ? { areas: cuerpo.areas as never } : {}),
      ...(cuerpo.expiresInDays ? { expiresInDays: Number(cuerpo.expiresInDays) } : {}),
    });
    res.status(201).json(invitacion);
  }),
);

router.delete(
  '/invitations/:id',
  tenantMiddleware,
  requireTenantAdmin(),
  asyncHandler(async (req, res) => {
    const revocada = await revokeInvitation(contextoDe(req), String(req.params.id));
    if (!revocada) throw new PlatformError('NOT_FOUND', 'Esa invitación no existe.');
    res.json({ ok: true });
  }),
);
