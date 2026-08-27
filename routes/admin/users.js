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
 * @db-write-via:incident-write-service incidents
 * @db-write-via:scan-write-service scans
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
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
const log = require('../../utils/logger').child({ module: 'admin/users' });

const guard = [authenticate, requireRole(['admin'])];
const VALID_ROLES = ['client', 'agent_relais', 'agent_hub', 'admin'];

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
    res.json({ users: rows, total: Number(countRow.count) });
  } catch(err) { next(err); }
});

// ─── POST /api/admin/users ─────────────────────────────────────────
router.post('/users', ...guard, async (req, res, next) => {
  const bcrypt = require('bcryptjs');
  try {
    const { full_name, email, phone, password, role = 'client', currency_pref = 'KMF' } = req.body;
    if (!full_name || !email || !password) return res.status(400).json({ error: 'full_name, email et password sont obligatoires' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rôle invalide. Utilisez : ${VALID_ROLES.join(', ')}` });
    const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length) return res.status(409).json({ error: 'Un utilisateur avec cet email existe déjà' });
    const password_hash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await createAdminUser(db, {
      fullName: full_name,
      email: email.toLowerCase().trim(),
      phone: phone || null,
      role,
      currencyPref: currency_pref,
      passwordHash: password_hash,
    });
    log.info(`👤 Admin created user ${user.email} (${role}) by ${req.user.email}`);
    res.status(201).json(user);
  } catch(err) { next(err); }
});

// ─── PUT /api/admin/users/:id/role ─────────────────────────────────
router.put('/users/:id/role', ...guard, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rôle invalide. Utilisez : ${VALID_ROLES.join(', ')}` });
    if (id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle' });
    const { rows: [user] } = await setUserRole(db, {
      userId: id,
      role,
    });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    log.info(`🔑 Admin changed role of ${user.email} to ${role} by ${req.user.email}`);
    res.json({ success: true, user });
  } catch(err) { next(err); }
});

// ─── PUT /api/admin/users/:id/password ─────────────────────────────
// V2.1: Password strength + self-change verification + same-password check
router.put('/users/:id/password', ...guard, async (req, res, next) => {
  const bcrypt = require('bcryptjs');
  try {
    const { id } = req.params;
    const { password, current_password } = req.body;

    // V2.1: Password strength validation
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

    // V2.1: Self-change requires current_password verification
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

    // V2.1: Prevent reusing same password
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
    if (Number(orderCount) > 0) {
      await anonymizeUser(db, id);
      log.info(`🗑️ Admin soft-deleted user ${user.email} by ${req.user.email}`);
      res.json({ success: true, message: `Utilisateur anonymisé (${orderCount} commande(s) conservée(s))`, type: 'soft_delete', deleted: { id, email: user.email, full_name: user.full_name } });
    } else {
      // Clean all potential FK references to this user before hard-deleting
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
    }
  } catch(err) { next(err); }
});

module.exports = router;
