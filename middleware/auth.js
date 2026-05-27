/**
 * KOMERCE — Middleware d'authentification JWT (sécurisé)
 *
 * authenticate       : vérifie le token (httpOnly cookie OU Bearer), injecte req.user
 * requireRole(roles) : vérifie que l'utilisateur a le bon rôle
 * requireAdmin       : raccourci pour requireRole(['admin'])
 */

const jwt = require('jsonwebtoken');
const db  = require('../db');
const log = require('../utils/logger').child({ module: 'auth' });
const userCache = require('../utils/user-cache');

const _JWT_SECRET = process.env.JWT_SECRET;

// Cache partagé via utils/user-cache.js (voir N2 FIX ci-dessus)
function getCachedUser(userId) { return userCache.get(userId); }
function setCachedUser(userId, user) { userCache.set(userId, user); }

function extractToken(req) {
  if (req.cookies && req.cookies.kmrc_jwt) return req.cookies.kmrc_jwt;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.split(' ')[1];
  return null;
}

function requestPath(req) {
  return (req.originalUrl || req.url || '').split('?')[0];
}

function isPickupPayCashRequest(req) {
  const path = requestPath(req);
  return req.method === 'POST' && /^\/api\/pickup\/pay-cash\/[^/]+$/.test(path);
}

function isQrVerifyRequest(req) {
  const path = requestPath(req);
  return req.method === 'POST' && path === '/api/scans/verify-qr';
}

function isStripeIntentRequest(req) {
  const path = requestPath(req);
  return req.method === 'POST' && path === '/api/payments/stripe/intent';
}

function isPurchasingRepairRequest(req) {
  const path = requestPath(req);
  return req.method === 'POST' && path === '/api/admin/purchasing/repair-ordered-without-pos';
}

function isPurchaseOrderReceiveRequest(req) {
  const path = requestPath(req);
  return req.method === 'POST' && /^\/api\/purchasing\/[^/]+\/receive$/.test(path);
}

function isCollectiveReadyRepairRequest(req) {
  const path = requestPath(req);
  return req.method === 'POST' && path === '/api/admin/collective/repair-ready-to-capture';
}

function isCollectiveStockReservationRepairRequest(req) {
  const path = requestPath(req);
  return req.method === 'POST' && path === '/api/admin/collective/repair-stock-reservations';
}

function isAdminOrderRefundRequest(req) {
  const path = requestPath(req);
  return req.method === 'POST' && /^\/api\/admin\/orders\/[^/]+\/refund$/.test(path);
}

function isPricingApplyPriceRequest(req) {
  const path = requestPath(req);
  return req.method === 'PUT' && /^\/api\/pricing\/apply-price\/[^/]+$/.test(path);
}

function isPricingApplyAllRequest(req) {
  const path = requestPath(req);
  return req.method === 'PUT' && path === '/api/pricing/apply-all';
}

async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Token manquant — connectez-vous' });
    }

    const decoded = jwt.verify(token, _JWT_SECRET, {
      algorithms: ['HS256'],
    });

    // N4 — vérifier que le jti n'est pas révoqué (logout explicite ou token compromis)
    if (decoded.jti) {
      const { rows: revoked } = await db.query(
        'SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1',
        [decoded.jti]
      );
      if (revoked.length) {
        return res.status(401).json({ error: 'Session expirée — reconnectez-vous' });
      }
    }

    let user = getCachedUser(decoded.id);

    if (!user) {
      const { rows } = await db.query(
        `SELECT id, full_name, email, phone, role, currency_pref, relais_id
         FROM users WHERE id = $1`,
        [decoded.id]
      );

      if (!rows.length) {
        return res.status(401).json({ error: 'Utilisateur introuvable ou compte supprimé' });
      }

      user = rows[0];
      setCachedUser(decoded.id, user);
    }

    req.user = user;

    if (isPickupPayCashRequest(req)) {
      return handleSafePickupCash(req, res, next);
    }

    if (isQrVerifyRequest(req)) {
      return handleSafeQrVerify(req, res, next);
    }

    if (isStripeIntentRequest(req)) {
      return handleIdempotentStripeIntent(req, res, next);
    }

    if (isPurchasingRepairRequest(req)) {
      return handlePurchasingRepair(req, res, next);
    }

    if (isPurchaseOrderReceiveRequest(req)) {
      return handleTransactionalPoReceive(req, res, next);
    }

    if (isCollectiveReadyRepairRequest(req)) {
      return handleCollectiveReadyRepair(req, res, next);
    }

    if (isCollectiveStockReservationRepairRequest(req)) {
      return handleCollectiveStockReservationRepair(req, res, next);
    }

    if (isAdminOrderRefundRequest(req)) {
      return handleAdminOrderRefund(req, res, next);
    }

    if (isPricingApplyPriceRequest(req)) {
      return handlePricingApplyPrice(req, res, next);
    }

    if (isPricingApplyAllRequest(req)) {
      return handlePricingApplyAll(req, res, next);
    }

    next();

  } catch (err) {
    if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
      log.error('[authenticate] erreur inattendue:', err.name, err.message);
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré — veuillez vous reconnecter' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

async function handleSafePickupCash(req, res, next) {
  const role = req.user && req.user.role;
  if (role !== 'admin' && role !== 'agent_relais') {
    return res.status(403).json({ error: 'Accès réservé agents relais et admin' });
  }

  try {
    const { confirmPickupCashPayment } = require('../services/confirm-pickup-cash-payment');
    const { generateAndStoreSecret } = require('../routes/pickup-secret');
    const orderId = requestPath(req).split('/').pop();

    const result = await confirmPickupCashPayment({
      orderId,
      user: req.user,
      payload: req.body,
      generateAndStoreSecret,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

async function handleSafeQrVerify(req, res, next) {
  const role = req.user && req.user.role;
  if (role !== 'admin' && role !== 'agent_relais') {
    return res.status(403).json({ error: 'Accès refusé — rôle requis : admin ou agent_relais' });
  }

  try {
    const { verifyQrCollection } = require('../services/verify-qr-collection');
    const result = await verifyQrCollection({
      token: req.body && req.body.token,
      orderId: req.body && req.body.order_id,
      user: req.user,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

async function handleIdempotentStripeIntent(req, res, next) {
  try {
    const { createStripeOrderIntent } = require('../services/create-stripe-order-intent');
    const result = await createStripeOrderIntent({
      orderReference: req.body && req.body.order_reference,
      user: req.user,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

async function handlePurchasingRepair(req, res, next) {
  try {
    const { repairOrderedWithoutPurchaseOrders } = require('../services/repair-ordered-without-purchase-orders');
    const result = await repairOrderedWithoutPurchaseOrders({
      dryRun: req.body?.dry_run !== false,
      limit: req.body?.limit || 25,
      user: req.user,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

async function handleTransactionalPoReceive(req, res, next) {
  const role = req.user && req.user.role;
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé — rôle requis : admin' });
  }

  try {
    const { receivePurchaseOrder } = require('../services/receive-purchase-order');
    let triggerScan3;
    try {
      triggerScan3 = require('../routes/scans').triggerScan3;
    } catch (_) {
      triggerScan3 = async () => {};
    }

    const path = requestPath(req);
    const parts = path.split('/');
    const poId = parts[3];

    const result = await receivePurchaseOrder({
      poId,
      qtyReceived: req.body && req.body.qty_recue,
      actor: req.user,
      triggerScan3,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

async function handleCollectiveReadyRepair(req, res, next) {
  try {
    const { repairCollectiveReadyToCapture } = require('../services/repair-collective-ready-to-capture');
    const result = await repairCollectiveReadyToCapture({
      dryRun: req.body?.dry_run !== false,
      limit: req.body?.limit || 25,
      minAgeMinutes: req.body?.min_age_minutes || 5,
      user: req.user,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

async function handleCollectiveStockReservationRepair(req, res, next) {
  try {
    const { repairCollectiveStockReservations } = require('../services/repair-collective-stock-reservations');
    const result = await repairCollectiveStockReservations({
      dryRun: req.body?.dry_run !== false,
      limit: req.body?.limit || 50,
      user: req.user,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

async function handleAdminOrderRefund(req, res, next) {
  try {
    const role = req.user && req.user.role;
    if (role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé admin' });
    }

    const { refundCancelledOrder } = require('../services/admin-order-refund');
    const orderId = requestPath(req).split('/')[3];
    const result = await refundCancelledOrder({
      orderId,
      user: req.user,
      dryRun: req.body?.dry_run !== false,
      reason: req.body?.reason || null,
      cashMode: req.body?.cash_mode || 'manual',
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

async function handlePricingApplyPrice(req, res, next) {
  try {
    const role = req.user && req.user.role;
    if (role !== 'admin') return res.status(403).json({ error: 'Accès réservé admin' });

    const { applySinglePrice } = require('../services/apply-pricing-updates');
    const productId = requestPath(req).split('/').pop();
    const result = await applySinglePrice({
      productId,
      priceKmf: req.body?.price_kmf,
      source: req.body?.source || 'manual',
      scenarioId: req.body?.scenario_id || null,
      scenarioLabel: req.body?.scenario_label || null,
      levier: req.body?.levier || null,
      user: req.user,
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

async function handlePricingApplyAll(req, res, next) {
  try {
    const role = req.user && req.user.role;
    if (role !== 'admin') return res.status(403).json({ error: 'Accès réservé admin' });

    const { applyAllPrices } = require('../services/apply-pricing-updates');
    const result = await applyAllPrices({
      items: req.body?.items || [],
      source: req.body?.source || 'batch',
      user: req.user,
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Accès refusé — rôle requis : ${roles.join(' ou ')}`,
        your_role: req.user.role,
      });
    }
    next();
  };
}

const requireAdmin = requireRole(['admin']);

function invalidateUserCache(userId) {
  userCache.invalidate(userId);
}

module.exports = { authenticate, requireRole, requireAdmin, invalidateUserCache };
