'use strict';
/** @test-kind unit */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname,'../..');
const cap = require('../../config/market-delegation-capabilities');
const obsolete = 'execution.order.mark_ordered';

test('la capability obsolète est absente du registre exécutable', () => {
  expect(cap.CAPABILITIES.map(x => x.capability)).not.toContain(obsolete);
  expect(cap.EFFECTS).not.toHaveProperty(obsolete);
});

test('aucun writer ou menu marché ne propose mark-ordered', () => {
  for (const file of [
    'routes/admin-operations-workspace.js',
    'public/dashboards/canonical/js/market-team.js',
    'bootstrap/api-routes.js',
  ]) {
    const content = fs.readFileSync(path.join(ROOT,file),'utf8');
    expect(content).not.toContain(obsolete);
  }
});

test('la migration conserve le nom des capabilities retirées dans les audits, sans droit résiduel', () => {
  const sql=fs.readFileSync(path.join(ROOT,'migrations/390_retire_mark_ordered_capability.sql'),'utf8');
  expect(sql).toContain("ADD COLUMN IF NOT EXISTS retired_capability");
  expect(sql).toContain('ON DELETE SET NULL');
  expect(sql).toContain("DELETE FROM public.membership_capabilities");
  expect(sql).toContain("DELETE FROM public.assignment_capability_ceiling");
  expect(sql).toContain("DELETE FROM public.ceiling_template_capabilities");
  expect(sql).toContain("DELETE FROM public.capability_registry");
});
