/**
 * @komerce-arch
 * @role          auth-recent-proof-guard
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        req.auth.authTime, req.auth.amr
 * @outputs       next_or_428_step_up_required
 * @depends       middleware/auth.js session proof context
 * @used-by       passkey management/enrollment, pickup authorization mutations
 * @doctrine      auth7_step_up_by_freshness_and_method
 * @impact-areas  auth, account-security
 * @version       2026-08
 */
'use strict';

const DEFAULT_MAX_AGE_SECONDS = 5 * 60;
const CLOCK_SKEW_SECONDS = 30;
const STRONG_METHODS = new Set(['otp', 'passkey']);

function maxAgeSeconds() {
  const configured = Number(process.env.AUTH_STEP_UP_MAX_AGE_SEC);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_AGE_SECONDS;
}

function hasStrongMethod(amr) {
  return Array.isArray(amr) && amr.some(method => STRONG_METHODS.has(String(method)));
}

function recentAuthStatus(auth, nowSeconds = Math.floor(Date.now() / 1000)) {
  const authTime = Number(auth?.authTime);
  const amr = auth?.amr;
  const maxAge = maxAgeSeconds();

  if (!Number.isFinite(authTime) || authTime <= 0) {
    return { ok: false, reason: 'auth_time_missing', maxAge };
  }
  if (authTime > nowSeconds + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'auth_time_in_future', maxAge };
  }
  if (!hasStrongMethod(amr)) {
    return { ok: false, reason: 'strong_method_missing', maxAge };
  }
  if ((nowSeconds - authTime) > maxAge) {
    return { ok: false, reason: 'auth_too_old', maxAge };
  }
  return { ok: true, maxAge };
}

function requireRecentAuth(req, res, next) {
  const status = recentAuthStatus(req.auth);
  if (status.ok) return next();

  return res.status(428).json({
    error: 'Authentification récente requise',
    code: 'step_up_required',
    reason: status.reason,
    max_age_seconds: status.maxAge,
    methods: ['passkey', 'otp'],
  });
}

module.exports = {
  DEFAULT_MAX_AGE_SECONDS,
  recentAuthStatus,
  requireRecentAuth,
};
