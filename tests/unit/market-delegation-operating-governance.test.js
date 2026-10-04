'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Market Control Plane M3 — operating governance foundation', () => {
  const migration = read('migrations/276_market_delegation_operating_governance.sql');

  test('designates one active operating lead without granting authority', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS is_operating_lead BOOLEAN NOT NULL DEFAULT FALSE/);
    expect(migration).toMatch(/uniq_active_assignment_operating_lead/);
    expect(migration).toMatch(/WHERE status = 'ACTIVE' AND is_operating_lead = TRUE/);
    expect(migration).toMatch(/Operating lead designation only\. Grants no capability by itself/);
  });

  test('adds central referent and membership duration as metadata', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS central_referent_user_id UUID REFERENCES users\(id\)/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS effective_until TIMESTAMPTZ/);
    expect(migration).toMatch(/effective_until IS NULL OR effective_until > granted_at/);
    expect(migration).toMatch(/Central referent designation only\. Grants no authority by itself/);
  });

  test('limits exist only for amount-bearing capabilities', () => {
    expect(migration).toMatch(/assignment_capability_ceiling[\s\S]*ADD COLUMN IF NOT EXISTS limit_amount NUMERIC\(20,6\)/);
    expect(migration).toMatch(/membership_capabilities[\s\S]*ADD COLUMN IF NOT EXISTS limit_amount NUMERIC\(20,6\)/);
    expect(migration).toMatch(/amount_bearing/);
    expect(migration).toMatch(/is not amount-bearing/);
  });

  test('finite ceiling requires member limit and member limit cannot exceed it', () => {
    expect(migration).toMatch(/membership limit required when ceiling limit is finite/);
    expect(migration).toMatch(/membership limit % exceeds ceiling limit %/);
    expect(migration).toMatch(/NEW\.limit_amount > v_ceiling_limit/);
  });

  test('NULL ceiling remains unlimited for existing markets', () => {
    expect(migration).toMatch(/IF v_ceiling_limit IS NOT NULL THEN/);
    expect(migration).toMatch(/NULL means unlimited ceiling/);
  });
});
