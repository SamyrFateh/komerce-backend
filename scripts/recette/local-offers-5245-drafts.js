'use strict';

// Staging fixture provisioning only; not a Chromium certification.
const assert = require('node:assert/strict');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const { validateManifest, applyManualDiscoveryContent } = require('../apply-manual-discovery-content');
const manifests = [
  require('../../docs/ops/manual-discovery-content.cm-5245.json'),
  require('../../docs/ops/manual-discovery-content.cg-5245.json'),
];

async function inspect(manifest, requirePresent = false) {
  const provider = manifest.providers[0];
  const offer = manifest.local_products[0];
  const { rows: markets } = await db.query(
    'SELECT id FROM markets WHERE code = $1 AND is_active = true', [manifest.market]);
  assert.equal(markets.length, 1, 'Expected exactly one active target market');
  const marketId = markets[0].id;
  const { rows: providers } = await db.query(
    'SELECT id, name, phone, market_id, status FROM providers WHERE id = $1', [provider.id]);
  const { rows: offers } = await db.query(
    'SELECT id, provider_id, title, description, zone, image_ref, market_id, status, commercial_exposure FROM physical_offers WHERE id = $1', [offer.id]);
  if (requirePresent) {
    assert.equal(providers.length, 1);
    assert.equal(offers.length, 1);
  }
  for (const p of providers) {
    assert.equal(p.market_id, marketId);
    assert.equal(p.status, 'pending');
    assert.equal(p.name, provider.name);
    assert.equal(p.phone, provider.phone);
  }
  for (const o of offers) {
    assert.equal(o.market_id, marketId);
    assert.equal(o.provider_id, provider.id);
    assert.equal(o.status, 'draft');
    assert.equal(o.commercial_exposure, 'DISABLED');
    assert.equal(o.title, offer.title);
    assert.equal(o.description, offer.description);
    assert.equal(o.zone, offer.zone);
    assert.equal(o.image_ref, null);
  }
  return { market: manifest.market, provider: providers.length, offer: offers.length, status: 'draft', exposed: false };
}

async function main() {
  assert.equal(process.env.KOMERCE_ENV, 'staging');
  assert.equal(process.env.KOMERCE_TARGET_ENV, 'staging');
  assert.equal(process.env.MANUAL_DISCOVERY_WRITE_ENABLED, 'true');
  await confirmTarget({ db });
  assert.deepEqual(manifests.map(m => m.market), ['CM', 'CG']);
  for (const m of manifests) {
    const validation = validateManifest(m);
    assert.ok(validation.ok, validation.errors.join('; '));
    assert.equal(m.providers.length, 1);
    assert.equal(m.local_products.length, 1);
    assert.equal(m.catalog_products.length, 0);
    assert.equal(m.services.length, 0);
    assert.equal(m.providers[0].status, 'pending');
    assert.equal(m.local_products[0].status, 'draft');
    assert.equal(m.local_products[0].expose, false);
    assert.equal(m.local_products[0].discovery, undefined);
    assert.equal(m.local_products[0].provider_id, m.providers[0].id);
    await inspect(m);
  }
  for (const m of manifests) {
    const result = await applyManualDiscoveryContent(m);
    assert.equal(result.market, m.market);
    assert.equal(result.discovery_candidates, '');
    console.log(JSON.stringify(await inspect(m, true)));
  }
  console.log('DRAFTS_PERSISTED — no commercial exposure; no Chromium certification');
}

main().catch(err => {
  console.error('Local drafts operation failed:', err.code || err.name);
  process.exitCode = 1;
}).finally(() => db.pool.end());
