#!/usr/bin/env node
'use strict';

/**
 * P0 runtime validation helper.
 *
 * Usage:
 *   P0_BASE_URL=https://... node scripts/p0-runtime-check.js
 *
 * Optional authenticated dry-run checks:
 *   P0_ADMIN_TOKEN=... node scripts/p0-runtime-check.js
 *
 * Optional ids:
 *   P0_ORDER_ID=...
 */

const { execFileSync } = require('child_process');

const BASE_URL = (process.env.P0_BASE_URL || '').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.P0_ADMIN_TOKEN || '';
const ORDER_ID = process.env.P0_ORDER_ID || '';

const results = [];

function add(name, status, details = '') {
  results.push({ name, status, details });
  const icon = status === 'PASS' ? '✅' : status === 'SKIP' ? '⏭️' : '❌';
  console.log(`${icon} ${name}${details ? ` — ${details}` : ''}`);
}

async function request(path, { method = 'GET', body = null, token = '' } = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  const text = await res.text();
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
  return { status: res.status, ok: res.ok, payload };
}

function runNpmTest() {
  try {
    execFileSync('npm', ['test'], { stdio: 'inherit', shell: process.platform === 'win32' });
    add('npm test', 'PASS');
  } catch (err) {
    add('npm test', 'FAIL', `exit=${err.status ?? 'unknown'}`);
  }
}

async function runHealthChecks() {
  if (!BASE_URL) {
    add('P0_BASE_URL', 'SKIP', 'absent — health checks non exécutés');
    return;
  }

  for (const path of ['/health', '/api/health']) {
    try {
      const r = await request(path);
      if (r.ok) add(`GET ${path}`, 'PASS', `HTTP ${r.status}`);
      else add(`GET ${path}`, 'FAIL', `HTTP ${r.status}`);
    } catch (err) {
      add(`GET ${path}`, 'FAIL', err.message);
    }
  }
}

async function runDryRunChecks() {
  if (!BASE_URL || !ADMIN_TOKEN) {
    add('admin dry-run checks', 'SKIP', 'P0_BASE_URL ou P0_ADMIN_TOKEN absent');
    return;
  }

  const dryRuns = [
    {
      name: 'collective ready_to_capture repair dry-run',
      path: '/api/admin/collective/repair-ready-to-capture',
      body: { dry_run: true, limit: 1 },
    },
    {
      name: 'collective stock reservations repair dry-run',
      path: '/api/admin/collective/repair-stock-reservations',
      body: { dry_run: true, limit: 1 },
    },
  ];

  if (ORDER_ID) {
    dryRuns.push({
      name: 'admin order refund dry-run',
      path: `/api/admin/orders/${ORDER_ID}/refund`,
      body: { dry_run: true, reason: 'P0 runtime validation' },
      acceptedStatuses: [200, 409, 404],
    });
  } else {
    add('admin order refund dry-run', 'SKIP', 'P0_ORDER_ID absent');
  }

  for (const check of dryRuns) {
    try {
      const r = await request(check.path, { method: 'POST', body: check.body, token: ADMIN_TOKEN });
      const accepted = check.acceptedStatuses || [200, 207];
      if (accepted.includes(r.status)) add(check.name, 'PASS', `HTTP ${r.status}`);
      else add(check.name, 'FAIL', `HTTP ${r.status}`);
    } catch (err) {
      add(check.name, 'FAIL', err.message);
    }
  }
}

async function main() {
  console.log('P0 runtime validation helper');
  console.log('='.repeat(32));

  runNpmTest();
  await runHealthChecks();
  await runDryRunChecks();

  const failed = results.filter(r => r.status === 'FAIL');
  const skipped = results.filter(r => r.status === 'SKIP');

  console.log('\nSummary');
  console.log('='.repeat(32));
  console.table(results);

  if (failed.length) {
    console.error(`\nP0 runtime verdict: FAIL (${failed.length} failed, ${skipped.length} skipped)`);
    process.exit(1);
  }

  if (skipped.length) {
    console.warn(`\nP0 runtime verdict: PARTIAL (${skipped.length} skipped)`);
    process.exit(2);
  }

  console.log('\nP0 runtime verdict: PASS');
}

main().catch(err => {
  console.error('P0 runtime check crashed:', err);
  process.exit(1);
});
