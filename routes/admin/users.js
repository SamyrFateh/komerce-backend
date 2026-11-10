/**
 * @komerce-arch
 * @role          dashboard-users
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, users
 * @db-write      order_status_history, recipients, scan_events, sms_log, wallet_transactions, wallets
 * @db-write-via:user-mutation-service users
 * @db-write-via:market-scope-admin-service operator_market_scopes (revocations)
 * @db-write-via:market-operator-provisioning market_operating_assignments, assignment_memberships, membership_capabilities, operator_market_scopes
 * @db-write-via:incident-write-service incidents
 * @db-write-via:scan-write-service scans
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard, market
 * @version       2026-09
 */

'use strict';

const express = require('express');
const { randomBytes } = require('crypto');
const { createActionToken } = require('../../services/credential-action-store');
const { sendCredentialLink } = require('../../services/credential-invitation-email');
const router  = express.Router();
const db      = require('../../db');
const { authenticate, requireRole, invalidateUserCache } = require('../../middleware/auth');
const { requireDashboardGlobalAuthority } = require('../../middleware/require-dashboard-global-authority');
const { detachUserFromScans } = require('../../services/scan-write-service');
const { detachUserFromIncidents } = require('../../services/incident-write-service');
const { deleteUserBasketData } = require('../../services/shared-cart-user-cleanup');
const {
  createAdminUser,
  markUserPendingActivation,
  setUserRole,
  setUserPasswordHash,
  anonymizeUser,
  deleteUser,
} = require('../../services/user-mutation-service');
const {
  normalizeMarketCode,
  normalizeScopeRole,
  listActiveMarkets,
  listActiveScopesForUsers,
  listUserMarketScopeHistory,
  hasUserMarketScopeHistory,
} = require('../../services/market-scope-admin-service');
const {
  grantOperatorScope,
  revokeOperatorScope,
  revokeAllOperatorScopes,
} = require('../../services/market-operator-provisioning');
const log = require('../../utils/logger').child({ module: 'admin/users' });

const guard = [authenticate, requireRole(['admin'])];
// Les scopes marché sont une autorité globale au même titre que les agrégats
// dashboard legacy (cf. PR #1452, CROSS_MARKET_BUG) : le rôle admin seul ne
// suffit pas, il faut le grant dashboard_global_access_grants.
const marketAuthorityGuard = [authenticate, requireRole(['admin']), requireDashboardGlobalAuthority];
// Identity roles supported by the canonical internal portal. A role NEVER
// grants a market membership or a global central capability: Finance and
// Transitaire need explicit delegated market grants; Sourcing needs an
// explicit sourcing_global_access_grants record (separate authority).
const VALID_ROLES = [
  'client', 'agent_relais', 'agent_hub', 'agent_transitaire',
  'admin', 'market_operator', 'finance', 'sourcing',
];
const PASSWORD_HASH_ROUNDS = 12;

function validatePasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Le mot de passe doit contenir au moins 8 caractères, 1 majuscule et 1 chiffre';
  }
  return null;
}

class ProvisioningError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendProvisioningError(res, err) {
  if (!(err instanceof ProvisioningError)) return false;
  res.status(err.status).json({ error: err.message, code: err.code });
  return true;
}

function parseMarketScope(body) {
  const raw = body && body.market_scope;
  if (!raw) return null;
  if (raw.market_id != null || (body && body.market_id != null)) {
    throw new ProvisioningError(
      400,
      'MARKET_ID_FORBIDDEN',
      'Utilisez market_scope.market_code ; market_id n’est jamais une autorité client.'
    );
  }
  const marketCode = normalizeMarketCode(raw.market_code);
  const scopeRole = normalizeScopeRole(raw.scope_role || raw.role);
  if (!marketCode) {
    throw new ProvisioningError(400, 'INVALID_MARKET_CODE', 'market_scope.market_code doit être un code pays ISO à 2 lettres.');
  }
  if (!scopeRole) {
    throw new ProvisioningError(400, 'INVALID_SCOPE_ROLE', 'market_scope.scope_role doit valoir viewer ou manager.');
  }
  return { marketCode, scopeRole };
}

// V1: API métier simple. L'autorité résulte exclusivement des codes résolus côté serveur.
function parseMarketCodes(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'market_codes')) return null;
  if (!Array.isArray(body.market_codes) || body.market_codes.length < 1 || body.market_codes.length > 20) {
    throw new ProvisioningError(400, 'INVALID_MARKET_CODES', 'Sélectionnez entre 1 et 20 marchés.');
  }
  const codes = body.market_codes.map((value) => {
    if (typeof value !== 'string') throw new ProvisioningError(400, 'INVALID_MARKET_CODE', 'Code marché invalide.');
    const code = normalizeMarketCode(value);
    if (!code) throw new ProvisioningError(400, 'INVALID_MARKET_CODE', 'Code marché invalide.');
    return code;
  });
  if (new Set(codes).size !== codes.length) {
    throw new ProvisioningError(400, 'DUPLICATE_MARKET_CODE', 'Un marché ne peut être sélectionné deux fois.');
  }
  if (body.market_scope || body.market_id != null) {
    throw new ProvisioningError(400, 'MIXED_MARKET_SCOPE_FORMAT', 'Utilisez market_codes sans market_scope ni market_id.');
  }
  return codes;
}

async function withTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
    throw err;
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

function indexScopesByUser(scopes) {
  const byUser = new Map();
  for (const scope of scopes) {
    const key = String(scope.user_id);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(scope);
  }
  return byUser;
}

// ─── GET /api/admin/users ──────────────────────────────────────────
router.get('/users', ...guard, async (req, res, next) => {
  try {
    const { role, search, limit = 100, offset = 0 } = req.query;
    const conditions = ['1=1'];
    const params     = [];
    let   pi         = 1;
    if (role && VALID_ROLES.includes(role)) { conditions.push(`u.role = $${pi++}`); params.push(role); }
    if (search) {
      conditions.push(`(u.full_name ILIKE $${pi} OR u.email ILIKE $${pi} OR u.phone ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }
    const where = conditions.join(' AND ');
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.created_at, u.updated_at, u.last_login_at, u.account_activation_required,
         COALESCE(u.currency_pref, 'KMF') AS currency_pref,
         COALESCE(u.country, 'KM') AS country
       FROM users u WHERE ${where} ORDER BY u.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, Number(limit), Number(offset)]
    );
    const { rows: [countRow] } = await db.query(
      `SELECT COUNT(*) AS count FROM users u WHERE ${where}`, params
    );
    const scopes = await listActiveScopesForUsers(db, rows.map((user) => user.id));
    const scopesByUser = indexScopesByUser(scopes);
    const users = rows.map((user) => ({
      ...user,
      market_scopes: scopesByUser.get(String(user.id)) || [],
    }));
    res.json({ users, total: Number(countRow.count) });
  } catch(err) { next(err); }
});

// ─── GET /api/admin/users/markets ──────────────────────────────────
router.get('/users/markets', ...marketAuthorityGuard, async (_req, res, next) => {
  try {
    const markets = await listActiveMarkets(db);
    res.json({ markets });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/users/:id/market-scopes ────────────────────────
router.get('/users/:id/market-scopes', ...marketAuthorityGuard, async (req, res, next) => {
  try {
    const { rows: [user] } = await db.query(
      'SELECT id, full_name, email, role FROM users WHERE id = $1::uuid',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const history = await listUserMarketScopeHistory(db, user.id);
    res.json({
      user,
      active: history.filter((scope) => !scope.revoked_at),
      history,
    });
  } catch (err) { next(err); }
});

// ─── POST /api/admin/users ─────────────────────────────────────────
router.post('/users', ...guard, (req, res, next) => {
  // Les rôles et affectations marché sont une autorité centrale, pas un simple
  // attribut d'identité. Refus explicite sans grant dashboard-global.
  if ((req.body?.role && req.body.role !== 'client') || req.body?.market_codes || req.body?.market_scope) {
    return requireDashboardGlobalAuthority(req, res, next);
  }
  next();
}, async (req, res, next) => {
  const bcrypt = require('bcryptjs');
  try {
    const { full_name, email, phone, password, role = 'client', currency_pref = 'KMF' } = req.body;
    const invite = req.body.invite === true;
    if (!full_name || !email || (!invite && !password)) {
      return res.status(400).json({ error: 'full_name, email et mot de passe (hors invitation) sont obligatoires' });
    }
    if (invite && !['admin','agent_hub','market_operator','agent_relais'].includes(role)) {
      return res.status(400).json({ code: 'INVITATION_ROLE_NOT_SUPPORTED', error: 'Profil non éligible à cette invitation V1.' });
    }
    if (invite && password != null) {
      return res.status(400).json({ code: 'INVITATION_PASSWORD_FORBIDDEN', error: 'Le destinataire choisit son mot de passe.' });
    }
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rôle invalide. Utilisez : ${VALID_ROLES.join(', ')}` });
    if (!invite) {
      const passwordPolicyError = validatePasswordPolicy(password);
      if (passwordPolicyError) {
        return res.status(400).json({ error: passwordPolicyError, code: 'WEAK_PASSWORD' });
      }
    }

    const marketCodes = parseMarketCodes(req.body);
    const marketScope = marketCodes ? null : parseMarketScope(req.body);
    if (role === 'market_operator' && !marketScope && !marketCodes) {
      return res.status(400).json({
        error: 'Sélectionnez au moins un marché dans market_codes.',
        code: 'MARKET_SCOPE_REQUIRED',
      });
    }
    if (role !== 'market_operator' && (marketScope || marketCodes)) {
      return res.status(400).json({
        error: 'market_scope est réservé au rôle market_operator.',
        code: 'MARKET_SCOPE_ROLE_MISMATCH',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.length) return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà' });
    const password_hash = await bcrypt.hash(invite ? randomBytes(32).toString('hex') : password, PASSWORD_HASH_ROUNDS);

    let user;
    let createdScope = null;
    let invitationToken = null;
    if (role === 'market_operator') {
      const result = await withTransaction(async (client) => {
        const { rows: [createdUser] } = await createAdminUser(client, {
          fullName: full_name,
          email: normalizedEmail,
          phone: phone || null,
          role,
          currencyPref: currency_pref,
          passwordHash: password_hash,
        });
        const requested = marketCodes || [marketScope.marketCode];
        const scopes = [];
        for (const marketCode of requested) {
          const grant = await grantOperatorScope(client, {
            userId: createdUser.id,
            marketCode,
            scopeRole: marketCodes ? 'manager' : marketScope.scopeRole,
            grantedBy: req.user.id,
          });
          if (grant.status === 'market_not_found') {
            throw new ProvisioningError(400, 'MARKET_NOT_FOUND', `Marché ${marketCode} introuvable ou inactif.`);
          }
          if (grant.status === 'invalid_scope_role') {
            throw new ProvisioningError(400, 'INVALID_SCOPE_ROLE', 'Le niveau de scope doit valoir viewer ou manager.');
          }
          scopes.push(grant.scope);
        }
        let token = null;
        if (invite) {
          await markUserPendingActivation(client, createdUser.id);
          token = (await createActionToken(client, {
            userId: createdUser.id, purpose: 'account_activation',
          })).token;
        }
        return { user: createdUser, scopes, token };
      });
      user = result.user;
      createdScope = result.scopes;
      invitationToken = result.token;
    } else if (invite) {
      const result = await withTransaction(async (client) => {
        const { rows: [createdUser] } = await createAdminUser(client, {
          fullName: full_name,
          email: normalizedEmail,
          phone: phone || null,
          role,
          currencyPref: currency_pref,
          passwordHash: password_hash,
        });
        await markUserPendingActivation(client, createdUser.id);
        const token = (await createActionToken(client, {
          userId: createdUser.id, purpose: 'account_activation',
        })).token;
        return { user: createdUser, token };
      });
      user = result.user;
      invitationToken = result.token;
    } else {
      const { rows: [createdUser] } = await createAdminUser(db, {
        fullName: full_name,
        email: normalizedEmail,
        phone: phone || null,
        role,
        currencyPref: currency_pref,
        passwordHash: password_hash,
      });
      user = createdUser;
    }

    // L'envoi n'a lieu qu'après COMMIT. Le jeton ne quitte jamais le serveur
    // par la réponse HTTP, même si Brevo est indisponible.
    const delivery = invitationToken
      ? await sendCredentialLink({ email: normalizedEmail, token: invitationToken, purpose: 'account_activation' })
      : null;
    log.info({ role, actorId: req.user.id, invited: invite, invitationSent: delivery?.sent || false },
      '[admin/users] Identité créée');
    res.status(201).json({
      ...user, market_scopes: createdScope || [],
      ...(invite ? { account_activation_required: true, invitation_sent: !!delivery?.sent } : {}),
    });
  } catch(err) {
    if (sendProvisioningError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/admin/users/:id/resend-invitation ──────────────────
// Admin central peut renvoyer un lien à un compte encore non activé.
// Ne renvoie jamais le secret; remplace tout ancien lien de même finalité.
router.post('/users/:id/resend-invitation', ...marketAuthorityGuard, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        'SELECT id, email, role, account_activation_required FROM users WHERE id=$1::uuid FOR UPDATE',
        [req.params.id]
      );
      if (!user) throw new ProvisioningError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable.');
      if (!user.account_activation_required) {
        throw new ProvisioningError(409, 'ACCOUNT_ALREADY_ACTIVATED', 'Compte déjà activé.');
      }
      if (!user.email) throw new ProvisioningError(409, 'INVITATION_EMAIL_REQUIRED', 'Email absent.');
      const token = (await createActionToken(client, {
        userId: user.id, purpose: 'account_activation',
      })).token;
      return { email: user.email, token };
    });
    const delivery = await sendCredentialLink({
      email: result.email, token: result.token, purpose: 'account_activation',
    });
    res.json({ success: !!delivery.sent, invitation_sent: !!delivery.sent });
  } catch (err) {
    if (sendProvisioningError(res, err)) return;
    next(err);
  }
});

// ─── PUT /api/admin/users/:id/role ─────────────────────────────────
router.put('/users/:id/role', ...marketAuthorityGuard, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rôle invalide. Utilisez : ${VALID_ROLES.join(', ')}` });
    if (id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle' });

    const marketCodes = parseMarketCodes(req.body);
    const marketScope = marketCodes ? null : parseMarketScope(req.body);
    const result = await withTransaction(async (client) => {
      const { rows: [existing] } = await client.query(
        'SELECT id, full_name, email, role FROM users WHERE id = $1::uuid FOR UPDATE',
        [id]
      );
      if (!existing) throw new ProvisioningError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable');

      if (role === 'market_operator' && existing.role !== 'market_operator' && !marketScope && !marketCodes) {
        throw new ProvisioningError(
          400,
          'MARKET_SCOPE_REQUIRED',
          'La promotion vers Responsable marché exige une sélection de marchés.'
        );
      }
      if (role !== 'market_operator' && (marketScope || marketCodes)) {
        throw new ProvisioningError(400, 'MARKET_SCOPE_ROLE_MISMATCH', 'market_scope est réservé au rôle market_operator.');
      }

      const { rows: [updatedUser] } = await setUserRole(client, { userId: id, role });
      const scopes = [];
      if (role === 'market_operator' && (marketScope || marketCodes)) {
        for (const marketCode of (marketCodes || [marketScope.marketCode])) {
          const grant = await grantOperatorScope(client, {
            userId: id,
            marketCode,
            scopeRole: marketCodes ? 'manager' : marketScope.scopeRole,
            grantedBy: req.user.id,
          });
          if (grant.status === 'market_not_found') {
            throw new ProvisioningError(400, 'MARKET_NOT_FOUND', `Marché ${marketCode} introuvable ou inactif.`);
          }
          scopes.push(grant.scope);
        }
      }
      if (role !== 'market_operator') {
        await revokeAllOperatorScopes(client, { userId: id, revokedBy: req.user.id });
      }
      return { user: updatedUser, scopes };
    });

    log.info(`🔑 Admin changed role of ${result.user.email} to ${role} by ${req.user.email}`);
    res.json({
      success: true,
      user: result.user,
      market_scope: result.scopes[0] || null, // compatibilité appels historiques
      market_scopes: result.scopes,
    });
  } catch(err) {
    if (sendProvisioningError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/admin/users/:id/market-scopes ───────────────────────
router.post('/users/:id/market-scopes', ...marketAuthorityGuard, async (req, res, next) => {
  try {
    const marketScope = parseMarketScope({ market_scope: req.body });
    if (!marketScope) throw new ProvisioningError(400, 'MARKET_SCOPE_REQUIRED', 'market_code et scope_role sont requis.');

    const result = await withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        'SELECT id, full_name, email, role FROM users WHERE id = $1::uuid FOR UPDATE',
        [req.params.id]
      );
      if (!user) throw new ProvisioningError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable');
      if (user.role !== 'market_operator') {
        throw new ProvisioningError(409, 'NOT_MARKET_OPERATOR', 'Les scopes marché ne peuvent être attribués qu’à un market_operator.');
      }
      const grant = await grantOperatorScope(client, {
        userId: user.id,
        marketCode: marketScope.marketCode,
        scopeRole: marketScope.scopeRole,
        grantedBy: req.user.id,
      });
      if (grant.status === 'market_not_found') {
        throw new ProvisioningError(400, 'MARKET_NOT_FOUND', `Marché ${marketScope.marketCode} introuvable ou inactif.`);
      }
      return { user, grant };
    });

    const status = result.grant.status === 'granted' ? 201 : 200;
    res.status(status).json({ success: true, status: result.grant.status, scope: result.grant.scope });
  } catch(err) {
    if (sendProvisioningError(res, err)) return;
    next(err);
  }
});

// ─── DELETE /api/admin/users/:id/market-scopes/:marketCode ────────
router.delete('/users/:id/market-scopes/:marketCode', ...marketAuthorityGuard, async (req, res, next) => {
  try {
    const code = normalizeMarketCode(req.params.marketCode);
    if (!code) return res.status(400).json({ error: 'Code marché invalide', code: 'INVALID_MARKET_CODE' });

    const result = await withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        'SELECT id, full_name, email, role FROM users WHERE id = $1::uuid FOR UPDATE',
        [req.params.id]
      );
      if (!user) throw new ProvisioningError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable');
      const revoke = await revokeOperatorScope(client, {
        userId: user.id,
        marketCode: code,
        revokedBy: req.user.id,
      });
      if (revoke.status === 'market_not_found') {
        throw new ProvisioningError(404, 'MARKET_NOT_FOUND', `Marché ${code} introuvable ou inactif.`);
      }
      return revoke;
    });

    if (result.status === 'not_active') {
      return res.status(404).json({ error: `Aucun scope actif ${code} pour cet utilisateur.`, code: 'MARKET_SCOPE_NOT_ACTIVE' });
    }
    res.json({ success: true, revoked: result.revoked });
  } catch(err) {
    if (sendProvisioningError(res, err)) return;
    next(err);
  }
});

// ─── PUT /api/admin/users/:id/password ─────────────────────────────
// V2.1: Password strength + self-change verification + same-password check
router.put('/users/:id/password', ...marketAuthorityGuard, async (req, res, next) => {
  const bcrypt = require('bcryptjs');
  try {
    const { id } = req.params;
    const { password, current_password } = req.body;

    const passwordPolicyError = validatePasswordPolicy(password);
  if (passwordPolicyError) {
    return res.status(400).json({ error: passwordPolicyError, code: 'WEAK_PASSWORD' });
  }

    const { rows: [existing] } = await db.query(
      'SELECT id, full_name, email, password_hash FROM users WHERE id = $1::uuid',
      [id]
    );
    if (!existing) return res.status(404).json({ error: 'Utilisateur introuvable' });

    if (id === req.user.id) {
      if (!current_password) {
        return res.status(400).json({
          error: 'current_password requis pour modifier votre propre mot de passe',
          code: 'CURRENT_PASSWORD_REQUIRED',
        });
      }
      const isValid = await bcrypt.compare(current_password, existing.password_hash);
      if (!isValid) {
        log.warn(`🔒 Failed self-password-change attempt for ${existing.email} from ${req.ip}`);
        return res.status(403).json({
          error: 'Mot de passe actuel incorrect',
          code: 'INVALID_CURRENT_PASSWORD',
        });
      }
    }

    const isSame = await bcrypt.compare(password, existing.password_hash);
    if (isSame) {
      return res.status(400).json({
        error: 'Le nouveau mot de passe doit être différent de l\'ancien',
        code: 'SAME_PASSWORD',
      });
    }

    const password_hash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
    await setUserPasswordHash(db, {
      userId: id,
      passwordHash: password_hash,
    });
    invalidateUserCache(id);

    const action = id === req.user.id ? 'self-changed' : 'admin-reset';
    log.info(`🔒 Password ${action} for ${existing.email} by ${req.user.email} (IP: ${req.ip})`);
    res.json({
      success: true,
      message: `Mot de passe ${id === req.user.id ? 'modifié' : 'réinitialisé'} pour ${existing.full_name}`,
    });
  } catch(err) { next(err); }
});

// ─── DELETE /api/admin/users/:id ───────────────────────────────────
router.delete('/users/:id', ...guard, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    const { rows: [user] } = await db.query('SELECT id, full_name, email, role FROM users WHERE id = $1::uuid', [id]);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const { rows: [{ count: orderCount }] } = await db.query('SELECT COUNT(*) FROM orders WHERE user_id = $1::uuid', [id]);
    const hasScopeHistory = await hasUserMarketScopeHistory(db, id);
    // Wallet : jamais supprimer. Un wallet avec ≥ 1 mouvement impose l'anonymisation.
    const { rows: [walletRow] } = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM wallet_transactions wt
           JOIN wallets w ON w.id = wt.wallet_id
          WHERE w.user_id = $1::uuid
       ) AS has_movements`,
      [id]
    );
    const hasWalletMovements = walletRow?.has_movements === true;

    if (Number(orderCount) > 0 || hasScopeHistory || hasWalletMovements) {
      await withTransaction(async (client) => {
        await revokeAllOperatorScopes(client, { userId: id, revokedBy: req.user.id });
        await anonymizeUser(client, id);
      });
      log.info(`🗑️ Admin soft-deleted user ${user.email} by ${req.user.email}`);
      const reason = hasScopeHistory ? 'historique de droits marché conservé'
        : hasWalletMovements && !(Number(orderCount) > 0) ? 'historique wallet conservé'
        : `${orderCount} commande(s) conservée(s)`;
      return res.json({
        success: true,
        message: `Utilisateur anonymisé (${reason})`,
        type: 'soft_delete',
        deleted: { id, email: user.email, full_name: user.full_name },
      });
    }

    const cleanupQueries = [
      'UPDATE sms_log SET user_id = NULL WHERE user_id = $1::uuid',
      'DELETE FROM loyalty_points WHERE user_id = $1::uuid',
      'DELETE FROM loyalty_history WHERE user_id = $1::uuid',
      () => deleteUserBasketData(db, id),
      'DELETE FROM recipients WHERE user_id = $1::uuid',
      'DELETE FROM favorites WHERE user_id = $1::uuid',
      'DELETE FROM wishlists WHERE user_id = $1::uuid',
      'DELETE FROM notifications WHERE user_id = $1::uuid',
      'DELETE FROM sessions WHERE user_id = $1::uuid',
      'DELETE FROM refresh_tokens WHERE user_id = $1::uuid',
      'DELETE FROM user_addresses WHERE user_id = $1::uuid',
      'UPDATE order_status_history SET changed_by = NULL WHERE changed_by = $1::uuid',
      () => detachUserFromScans(db, id),
      'UPDATE scan_events SET scanned_by = NULL WHERE scanned_by = $1::uuid',
      () => detachUserFromIncidents(db, id),
    ];
    for (const q of cleanupQueries) {
      try {
        if (typeof q === 'function') await q();
        else await db.query(q, [id]);
      } catch (_) { /* table may not exist */ }
    }
    await deleteUser(db, id);
    log.info(`🗑️ Admin hard-deleted user ${user.email} by ${req.user.email}`);
    res.json({ success: true, message: `Utilisateur ${user.full_name} supprimé définitivement`, type: 'hard_delete', deleted: { id, email: user.email, full_name: user.full_name } });
  } catch(err) { next(err); }
});

module.exports = router;
