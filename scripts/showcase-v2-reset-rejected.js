#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-replay-reset
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        railway_staging synthetic sourcing candidates
 * @outputs       replayable SHOWCASE-V2 candidate states + trace events
 * @depends       db.js
 * @used-by       showcase v2 staging deploy
 * @db-read       sourcing_candidates
 * @db-write      sourcing_candidates, sourcing_candidate_events
 * @db-txn        single CTE statement
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @version       2026-08-v1
 */
'use strict';

const db = require('../db');

const SUPPLIER_NAME = 'Komerce Showcase V2';

function assertStaging() {
  if (process.env.NODE_ENV === 'production' || process.env.KOMERCE_ENV === 'production') {
    throw new Error('REFUS: reset Showcase V2 interdit en production');
  }
  if (process.env.KOMERCE_ALLOW_SHOWCASE_SEED !== '1') {
    throw new Error('KOMERCE_ALLOW_SHOWCASE_SEED=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

async function resetRejectedSyntheticCandidates() {
  assertStaging();
  const { rows } = await db.query(
    `WITH reset AS (
       UPDATE sourcing_candidates
          SET state='scanned',
              rejected_reason=NULL,
              scan_result=NULL,
              scan_at=NULL,
              updated_at=NOW()
        WHERE supplier_name=$1
          AND supplier_product_id LIKE 'SHOWCASE-V2-%'
          AND state='rejected'
        RETURNING id, supplier_product_id
     )
     INSERT INTO sourcing_candidate_events
       (candidate_id, event_type, old_state, new_state, changes, notes)
     SELECT id,
            'state_change',
            'rejected',
            'scanned',
            jsonb_build_object('showcase_v2_replay_reset', true, 'supplier_product_id', supplier_product_id),
            'Replay staging Showcase V2 : rejet synthétique remis en calcul avant réimport.'
       FROM reset
     RETURNING candidate_id`,
    [SUPPLIER_NAME],
  );
  console.log(`[showcase-v2-reset] candidats synthétiques remis en calcul: ${rows.length}`);
  return rows.length;
}

async function main() {
  try {
    await resetRejectedSyntheticCandidates();
  } finally {
    await db.pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase-v2-reset] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { assertStaging, resetRejectedSyntheticCandidates };
