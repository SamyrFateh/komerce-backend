'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '273_market_delegation_partners_authority.sql'),
  'utf8'
);

describe('migration 273 — Partners authority', () => {
  test('déclare deux capabilities sémantiques et ne détourne pas provider.manage', () => {
    expect(migration).toContain("'partners.read','DELEGATION','partners','MARKET','DELEGABLE',FALSE,'LIVE','READ',FALSE");
    expect(migration).toContain("'partners.manage','DELEGATION','partners','MARKET','DELEGABLE',TRUE,'LIVE','ACT',FALSE");
    const code = migration.replace(/^--.*$/gm, '');
    expect(code).not.toMatch(/provider\.manage/);
  });

  test('partners.read est accordée à toutes les memberships actives', () => {
    expect(migration).toMatch(/INSERT INTO membership_capabilities[\s\S]*'partners\.read'[\s\S]*am\.status = 'ACTIVE'/);
    expect(migration).toContain("'CAPABILITY_GRANTED_BY_PROMOTION'");
  });

  test('partners.manage ne promeut que le signal manager canonique', () => {
    const manage = migration.slice(migration.indexOf('-- Legacy manager parity'));
    expect(manage).toContain("'team.grant'");
    expect(manage).toContain("'team.revoke'");
    expect(manage).toContain("'network.read'");
    expect(manage).toContain("'partners.manage'");
  });

  test('les ceilings futurs et existants reçoivent les deux capabilities', () => {
    expect(migration).toMatch(/ceiling_template_capabilities/);
    expect(migration).toMatch(/assignment_capability_ceiling/);
    expect(migration).toContain("('partners.read'::text), ('partners.manage'::text)");
  });
});
