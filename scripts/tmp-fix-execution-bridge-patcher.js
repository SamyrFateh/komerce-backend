'use strict';
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'tmp-apply-execution-bridge-v2.js');
const fixed = path.join(__dirname, 'tmp-apply-execution-bridge-v2-fixed.js');
let s = fs.readFileSync(source, 'utf8');

const replacements = [
  [
    '.post(`/api/market-delegation/markets/${fx.marketA.code}/team/invitations`)',
    ".post('/api/market-delegation/markets/' + fx.marketA.code + '/team/invitations')",
  ],
  [
    '.post(`/api/admin/workspaces/operations/market/${fx.marketA.code}/distribution/run`)',
    ".post('/api/admin/workspaces/operations/market/' + fx.marketA.code + '/distribution/run')",
  ],
  [
    '.post(`/api/admin/workspaces/operations/market/${fx.marketB.code}/distribution/run`)',
    ".post('/api/admin/workspaces/operations/market/' + fx.marketB.code + '/distribution/run')",
  ],
];

for (const [from, to] of replacements) {
  if (!s.includes(from)) throw new Error(`bootstrap quote target missing: ${from}`);
  s = s.split(from).join(to);
}

const auditSql = /      `SELECT actor_user_id, membership_id, capability, action, correlation_id\n         FROM market_delegation_audit\n        WHERE assignment_id=\$1 AND actor_user_id=\$2 AND capability='execution\.distribution\.run'\n          AND action='EXECUTION_AUTHORIZED' AND correlation_id='e2e-exec-distribution'`,/;
if (!auditSql.test(s)) throw new Error('bootstrap audit SQL target missing');
s = s.replace(
  auditSql,
  '      "SELECT actor_user_id, membership_id, capability, action, correlation_id FROM market_delegation_audit WHERE assignment_id=$1 AND actor_user_id=$2 AND capability=\'execution.distribution.run\' AND action=\'EXECUTION_AUTHORIZED\' AND correlation_id=\'e2e-exec-distribution\'",'
);

fs.writeFileSync(fixed, s, 'utf8');
require(fixed);
