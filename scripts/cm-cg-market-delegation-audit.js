#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cm-cg-market-delegation-audit
 * @domain        market-control-plane
 * @layer         tooling
 * @criticality   low
 * @inputs        DATABASE_URL
 * @outputs       read-only historical assignment/membership view for CG and CM
 * @depends       db.js
 * @used-by       explicit CG/CM reprovision certification
 * @db-read       markets, market_operating_assignments, assignment_memberships, users
 * @db-write      none
 * @db-txn        none
 * @doctrine      tooling_is_read_only, preserve_authority_history, identify_before_reprovision
 * @impact-areas  market-control-plane, market-delegation, authorization
 * @version       2026-10-v1
 */
'use strict';

const db = require('../db');

const TARGET_CODES = Object.freeze(['CG', 'CM']);

async function auditState(queryable = db) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new TypeError('cm-cg-market-delegation-audit: queryable.query requis');
  }

  const { rows } = await queryable.query(
    `SELECT
       m.code,
       m.id AS market_id,
       moa.id AS assignment_id,
       moa.status AS assignment_status,
       moa.central_referent_user_id,
       am.id AS membership_id,
       am.user_id,
       am.status AS membership_status,
       am.is_operating_lead,
       u.full_name,
       u.email,
       u.phone,
       u.role
     FROM markets m
     LEFT JOIN market_operating_assignments moa
       ON moa.market_id=m.id
     LEFT JOIN assignment_memberships am
       ON am.assignment_id=moa.id
     LEFT JOIN users u
       ON u.id=am.user_id
     WHERE m.code = ANY($1::text[])
     ORDER BY m.code, moa.created_at, am.granted_at`,
    [TARGET_CODES]
  );

  return {
    target_codes: TARGET_CODES,
    rows,
  };
}

async function main() {
  console.log(JSON.stringify(await auditState(), null, 2));
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error('[cm-cg-market-delegation-audit] FAILED ' + (error.stack || error.message || error));
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  TARGET_CODES,
  auditState,
  main,
};
