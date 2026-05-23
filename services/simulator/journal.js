/**
 * Simulator Journal — traçabilité complète de chaque action
 */
'use strict';

const entries = [];

function log(orderId, ref, scenario, message, success) {
  entries.push({
    time: new Date().toISOString().slice(11, 19),
    timestamp: Date.now(),
    orderId: orderId || null,
    ref: ref || '—',
    scenario: scenario || null,
    message,
    success: success !== false
  });
  const prefix = success === false ? '❌' : '✅';
  log.info(`[SIM] ${prefix} ${ref || '—'} | ${message}`);
}

function getRecent(n) { return entries.slice(-n); }
function getAll() { return entries; }
function getForOrder(orderId) { return entries.filter(e => e.orderId === orderId); }
function countSuccess() { return entries.filter(e => e.success && e.orderId).length; }
function countChaos() { return entries.filter(e => e.message && e.message.includes('Chaos')).length; }
function clear() { entries.length = 0; }

module.exports = { log, getRecent, getAll, getForOrder, countSuccess, countChaos, clear };
