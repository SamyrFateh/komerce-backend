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
 * @db-write-via:market-scope-admin-service operator_market_scopes
 * @db-write-via:incident-write-service incidents
 * @db-write-via:scan-write-service scans
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard, market
 * @version       2026-09
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { detachUserFromScans } = require('../../services/scan-write-service');
const { detachUserFromIncidents } = require('../../services/incident-write-service');
const { deleteUserBasketData } = require('../../services/shared-cart-user-cleanup');
const {
  createAdminUser,
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
  grantOrReplaceMarketScope,
  revokeMarketScope,
  revokeAllUserMarketScopes,
} = require('../../services/market-scope-admin-service');
const log = require('../../utils/logger').child({ module: 'admin/users' });

const guard = [authenticate, requireRole(['admin'])];
const VALID_ROLES = ['client', 'agent_relais', 'agent_hub', 'admin', 'market_operator'];

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
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.created_at, u.updated_at, u.last_login_at,
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
router.get('/users/markets', ...guard, async (_req, res, next) => {
  try {
    const markets = await listActiveMarkets(db);
    res.json({ markets });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/users/:id/market-scopes ────────────────────────
router.get('/users/:id/market-scopes', ...guard, async (req, res, next) => {
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
router.post('/users', ...guard, async (req, res, next) => {
  const bcrypt = require('bcryptjs');
  try {
    const { full_name, email, phone, password, role = 'client', currency_pref = 'KMF' } = req.body;
    if (!full_name || !email || !password) return res.status(400).json({ error: 'full_name, email et password sont obligatoires' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rôle invalide. Utilisez : ${VALID_ROLES.join(', ')}` });

    const marketScope = parseMarketScope(req.body);
    if (role === 'market_operator' && !marketScope) {
      return res.status(400).json({
        error: 'Un market_operator doit être créé avec market_scope.market_code et market_scope.scope_role.',
        code: 'MARKET_SCOPE_REQUIRED',
      });
    }
    if (role !== 'market_operator' && marketScope) {
      return res.status(400).json({
        error: 'market_scope est réservé au rôle market_operator.',
        code: 'MARKET_SCOPE_ROLE_MISMATCH',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.length) return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà' });
    const password_hash = await bcrypt.hash(password, 10);

    let user;
    let createdScope = null;
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
        const grant = await grantOrReplaceMarketScope(client, {
          userId: createdUser.id,
          marketCode: marketScope.marketCode,
          scopeRole: marketScope.scopeRole,
          grantedBy: req.user.id,
        });
        if (grant.status === 'market_not_found') {
          throw new ProvisioningError(400, 'MARKET_NOT_FOUND', `Marché ${marketScope.marketCode} introuvable ou inactif.`);
        }
        if (grant.status === 'invalid_scope_role') {
          throw new ProvisioningError(400, 'INVALID_SCOPE_ROLE', 'Le niveau de scope doit valoir viewer ou manager.');
        }
        return { user: createdUser, scope: grant.scope };
      });
      user = result.user;
      createdScope = result.scope;
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

    log.info(`👤 Admin created user ${user.email} (${role}) by ${req.user.email}`);
    res.status(201).json({ ...user, market_scopes: createdScope ? [createdScope] : [] });
  } catch(err) {
    if (sendProvisioningError(res, err)) return;
    next(err);
  }
});

// ─── PUT /api/admin/users/:id/role ─────────────────────────────────
router.put('/users/:id/role', ...guard, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rôle invalide. Utilisez : ${VALID_ROLES.join(', ')}` });
    if (id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle' });

    const marketScope = parseMarketScope(req.body);
    const result = await withTransaction(async (client) => {
      const { rows: [existing] } = await client.query(
        'SELECT id, full_name, email, role FROM users WHERE id = $1::uuid FOR UPDATE',
        [id]
      );
      if (!existing) throw new ProvisioningError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable');

      if (role === 'market_operator' && existing.role !== 'market_operator' && !marketScope) {
        throw new ProvisioningError(
          400,
          'MARKET_SCOPE_REQUIRED',
          'La promotion vers market_operator exige market_scope.market_code et market_scope.scope_role.'
        );
      }
      if (role !== 'market_operator' && marketScope) {
        throw new ProvisioningError(400, 'MARKET_SCOPE_ROLE_MISMATCH', 'market_scope est réservé au rôle market_operator.');
      }

      const { rows: [updatedUser] } = await setUserRole(client, { userId: id, role });
      let scope = null;
      if (role === 'market_operator' && marketScope) {
        const grant = await grantOrReplaceMarketScope(client, {
          userId: id,
          marketCode: marketScope.marketCode,
          scopeRole: marketScope.scopeRole,
          grantedBy: req.user.id,
        });
        if (grant.status === 'market_not_found') {
          throw new ProvisioningError(400, 'MARKET_NOT_FOUND', `Marché ${marketScope.marketCode} introuvable ou inactif.`);
        }
        scope = grant.scope;
      }
      if (role !== 'market_operator') {
        await revokeAllUserMarketScopes(client, { userId: id, revokedBy: req.user.id });
      }
      return { user: updatedUser, scope };
    });

    log.info(`🔑 Admin changed role of ${result.user.email} to ${role} by ${req.user.email}`);
    res.json({ success: true, user: result.user, market_scope: result.scope });
  } catch(err) {
    if (sendProvisioningError(res, err)) return;
    next(err);
  }
});

// ─── POST /api/admin/users/:id/market-scopes ───────────────────────
router.post('/users/:id/market-scopes', ...guard, async (req, res, next) => {
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
      const grant = await grantOrReplaceMarketScope(client, {
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
router.delete('/users/:id/market-scopes/:marketCode', ...guard, async (req, res, next) => {
  try {
    const code = normalizeMarketCode(req.params.marketCode);
    if (!code) return res.status(400).json({ error: 'Code marché invalide', code: 'INVALID_MARKET_CODE' });

    const result = await withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        'SELECT id, full_name, email, role FROM users WHERE id = $1::uuid FOR UPDATE',
        [req.params.id]
      );
      if (!user) throw new ProvisioningError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable');
      const revoke = await revokeMarketScope(client, {
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
router.put('/users/:id/password', ...guard, async (req, res, next) => {
  const bcrypt = require('bcryptjs');
  try {
    const { id } = req.params;
    const { password, current_password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 8 caractères',
        code: 'WEAK_PASSWORD',
      });
    }
    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 1 majuscule et 1 chiffre',
        code: 'WEAK_PASSWORD',
      });
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

    const password_hash = await bcrypt.hash(password, 12);
    await setUserPasswordHash(db, {
      userId: id,
      passwordHash: password_hash,
    });

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

    if (Number(orderCount) > 0 || hasScopeHistory) {
      await withTransaction(async (client) => {
        await revokeAllUserMarketScopes(client, { userId: id, revokedBy: req.user.id });
        await anonymizeUser(client, id);
      });
      log.info(`🗑️ Admin soft-deleted user ${user.email} by ${req.user.email}`);
      const reason = hasScopeHistory ? 'historique de droits marché conservé' : `${orderCount} commande(s) conservée(s)`;
      return res.json({
        success: true,
        message: `Utilisateur anonymisé (${reason})`,
        type: 'soft_delete',
        deleted: { id, email: user.email, full_name: user.full_name },
      });
    }

    const cleanupQueries = [
      'UPDATE sms_log SET user_id = NULL WHERE user_id = $1::uuid',
      'DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = $1::uuid)',
      'DELETE FROM wallets WHERE user_id = $1::uuid',
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
