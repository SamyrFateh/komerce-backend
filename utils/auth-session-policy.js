/**
 * @komerce-arch
 * @role          auth-session-policy
 * @domain        auth
 * @layer         util
 * @criticality   high
 * @inputs        JWT_EXPIRES
 * @outputs       bounded_session_ttl
 * @depends       none
 * @db-read       none
 * @db-write      none
 * @doctrine      auth8_absolute_session_ttl_bounded
 * @impact-areas  auth, account-security
 * @version       2026-08
 */
'use strict';

const MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_SESSION_TTL_SECONDS = MAX_SESSION_TTL_SECONDS;

function _parseDurationSeconds(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const multiplier = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  }[match[2]];

  return amount * multiplier;
}

/**
 * AUTH-8d — durée absolue de session.
 *
 * `JWT_EXPIRES` peut raccourcir la session, jamais l'allonger au-delà de 7 jours.
 * Une valeur invalide revient au plafond sûr de 7 jours au lieu de restaurer
 * silencieusement l'ancien défaut de 30 jours.
 */
function resolveSessionTtlSeconds(value = process.env.JWT_EXPIRES) {
  const parsed = _parseDurationSeconds(value);
  if (!parsed) return DEFAULT_SESSION_TTL_SECONDS;
  return Math.min(parsed, MAX_SESSION_TTL_SECONDS);
}

function resolveSessionTtlMs(value = process.env.JWT_EXPIRES) {
  return resolveSessionTtlSeconds(value) * 1000;
}

module.exports = {
  MAX_SESSION_TTL_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  resolveSessionTtlSeconds,
  resolveSessionTtlMs,
};
